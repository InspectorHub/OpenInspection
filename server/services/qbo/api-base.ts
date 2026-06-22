import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { qboConnections, qboSyncErrors } from '../../lib/db/schema/qbo';
import { encryptToken, decryptToken } from '../../lib/qbo-crypto';
import { QBOTokenResponseSchema } from '../../lib/validations/qbo.schema';

export const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
export const MINOR_VERSION = '75';
export const ACCESS_TOKEN_TTL_SEC = 3600;
export const CDC_PAGE_SIZE = 1000;

export interface QBOConnectionStatus {
    realmId: string;
    companyName: string | null;
    lastSyncAt: number | null;
    syncEnabled: boolean;
    openErrors: number;
    refreshTokenExpiresAt: number;
}

export type QBOToken = {
    accessToken: string;
    realmId: string;
    tenantId: string;
};

export type InvoiceSummary = { Id: string; SyncToken: string; Balance: number; TotalAmt: number };

export type MarkPaidFn = (invoiceId: string, tenantId: string) => Promise<void>;
export type MarkPartialFn = (invoiceId: string, balance: number, tenantId: string) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

export class QBOServiceBase {
    constructor(
        protected db: D1Database,
        protected clientId: string,
        protected clientSecret: string,
        protected webhookSecret: string,
        protected jwtSecret: string,
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected getDrizzle() { return drizzle(this.db as any); }

    protected buildBasicAuth(): string {
        return 'Basic ' + btoa(`${this.clientId}:${this.clientSecret}`);
    }

    protected async getToken(tenantId: string): Promise<QBOToken> {
        const db = this.getDrizzle();
        const row = await db.select().from(qboConnections)
            .where(eq(qboConnections.tenantId, tenantId)).get();
        if (!row) throw new Error(`No QBO connection for tenant ${tenantId}`);

        const now = Math.floor(Date.now() / 1000);
        if (row.tokenExpiresAt - now < 300) {
            return this.refreshToken(tenantId);
        }
        const accessToken = await decryptToken(row.accessToken, this.jwtSecret);
        return { accessToken, realmId: row.realmId, tenantId };
    }

    protected async refreshToken(tenantId: string): Promise<QBOToken> {
        const db = this.getDrizzle();
        const row = await db.select().from(qboConnections)
            .where(eq(qboConnections.tenantId, tenantId)).get();
        if (!row) throw new Error(`No QBO connection for tenant ${tenantId}`);

        const currentRefresh = await decryptToken(row.refreshToken, this.jwtSecret);
        const resp = await fetch(QBO_TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: this.buildBasicAuth(),
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: currentRefresh,
            }),
        });

        if (!resp.ok) {
            await db.delete(qboConnections).where(eq(qboConnections.tenantId, tenantId));
            throw new Error('QBO token refresh failed — reconnect required');
        }

        const data = QBOTokenResponseSchema.parse(await resp.json());
        const now = Math.floor(Date.now() / 1000);

        await db.update(qboConnections).set({
            accessToken:           await encryptToken(data.access_token, this.jwtSecret),
            refreshToken:          await encryptToken(data.refresh_token, this.jwtSecret),
            tokenExpiresAt:        now + ACCESS_TOKEN_TTL_SEC,
            refreshTokenExpiresAt: now + data.x_refresh_token_expires_in,
        }).where(eq(qboConnections.tenantId, tenantId));

        return { accessToken: data.access_token, realmId: row.realmId, tenantId };
    }

    protected async apiCall<T>(
        tenantId: string,
        method: 'GET' | 'POST' | 'PUT',
        path: string,
        body?: unknown,
    ): Promise<T> {
        const { accessToken, realmId } = await this.getToken(tenantId);
        const separator = path.includes('?') ? '&' : '?';
        const url = `${QBO_API_BASE}/${realmId}/${path}${separator}minorversion=${MINOR_VERSION}`;

        const opts: RequestInit = {
            method,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        };
        if (body !== undefined) opts.body = JSON.stringify(body);

        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2 ** attempt * 500));
            const resp = await fetch(url, opts);
            if (resp.ok) return resp.json() as T;
            if (resp.status === 429) {
                const retryAfter = parseInt(resp.headers.get('Retry-After') ?? '60', 10);
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }
            if (resp.status >= 500) {
                lastError = new Error(`QBO ${resp.status}`);
                continue;
            }
            const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
            throw Object.assign(new Error(`QBO ${resp.status}`), { qboResponse: err, status: resp.status });
        }
        throw lastError ?? new Error('QBO API call failed after retries');
    }

    protected async qboQuery<T>(tenantId: string, query: string): Promise<T> {
        return this.apiCall<T>(tenantId, 'GET', `query?query=${encodeURIComponent(query)}`);
    }

    protected async logSyncError(tenantId: string, oiType: string, oiId: string, error: unknown): Promise<void> {
        const db = this.getDrizzle();
        const now = Math.floor(Date.now() / 1000);
        const msg = error instanceof Error ? error.message : String(error);
        const existing = await db.select().from(qboSyncErrors)
            .where(and(
                eq(qboSyncErrors.tenantId, tenantId),
                eq(qboSyncErrors.oiType, oiType),
                eq(qboSyncErrors.oiId, oiId),
                eq(qboSyncErrors.resolved, false),
            )).get();

        if (existing) {
            await db.update(qboSyncErrors).set({
                retries:   existing.retries + 1,
                errorMsg:  msg,
                updatedAt: now,
            }).where(eq(qboSyncErrors.id, existing.id));
        } else {
            await db.insert(qboSyncErrors).values({
                id:        crypto.randomUUID(),
                tenantId,
                oiType,
                oiId,
                errorCode: 'SYNC_ERROR',
                errorMsg:  msg,
                retries:   0,
                resolved:  false,
                createdAt: now,
                updatedAt: now,
            });
        }
    }
}
