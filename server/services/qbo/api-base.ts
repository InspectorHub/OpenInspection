import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { qboConnections, qboSyncErrors } from '../../lib/db/schema/qbo';
import { encryptToken, decryptToken } from '../../lib/qbo-crypto';
import { QBOTokenResponseSchema } from '../../lib/validations/qbo.schema';
import { QBO_PAYMENT_DISCREPANCY, encodePaymentDiscrepancy } from '../../lib/qbo-discrepancy';

/**
 * QuickBooks serves sandbox companies and real companies from two different
 * hosts, and the credentials are not interchangeable: Intuit Development keys
 * authenticate only against sandbox, Production keys only against production.
 * So the host is a deployment decision, named by `QBO_ENV`.
 *
 * There is deliberately NO default. Either default is wrong half the time, and
 * both failure modes are silent to the operator: pointed at production with
 * Development keys you get an auth error that reads like a bad secret, and
 * pointed at sandbox with Production keys a paying customer's books quietly
 * receive nothing. Unset raises instead — see `resolveQboApiBase`.
 *
 * The OAuth token and revoke endpoints below are shared by both environments;
 * only the accounting API host differs.
 */
const QBO_API_HOSTS: Record<string, string> = {
    sandbox:    'https://sandbox-quickbooks.api.intuit.com',
    production: 'https://quickbooks.api.intuit.com',
};

/** The company-scoped API base for `QBO_ENV`. Throws when it is unset or unknown. */
export function resolveQboApiBase(qboEnv: string | undefined): string {
    const host = qboEnv ? QBO_API_HOSTS[qboEnv] : undefined;
    if (!host) {
        throw new Error(
            `QBO_ENV must be one of [${Object.keys(QBO_API_HOSTS).join(', ')}] to reach the QuickBooks API (got ${qboEnv === undefined ? 'unset' : `"${qboEnv}"`})`,
        );
    }
    return `${host}/v3/company`;
}

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR_VERSION = '75';
export const ACCESS_TOKEN_TTL_SEC = 3600;
export const CDC_PAGE_SIZE = 1000;

/** One invoice where QuickBooks and our ledger disagree, with BOTH figures. */
export interface QBOPaymentDiscrepancy {
    id: string;
    invoiceId: string;
    currency: string;
    ledgerCents: number;
    qboCents: number;
}

export interface QBOConnectionStatus {
    realmId: string;
    companyName: string | null;
    lastSyncAt: number | null;
    syncEnabled: boolean;
    /** Failed pushes only. Discrepancies are not errors and are counted below. */
    openErrors: number;
    paymentDiscrepancies: QBOPaymentDiscrepancy[];
    /**
     * Payments taken before an invoice existed. They are deliberately NOT sent
     * to QuickBooks — see the settings copy — so the count is disclosed rather
     * than the cash quietly under-reported. A count and not an amount: these
     * rows predate the invoice that carries the currency, and inventing one
     * would be a worse lie than saying less.
     */
    heldDepositCount: number;
    refreshTokenExpiresAt: number;
}

export type QBOToken = {
    accessToken: string;
    realmId: string;
    tenantId: string;
};

export type InvoiceSummary = { Id: string; SyncToken: string; Balance: number; TotalAmt: number };

export type MarkPaidFn = (invoiceId: string, tenantId: string) => Promise<void>;
/**
 * Second argument is the amount already RECEIVED, in integer cents — not the
 * remaining balance and not dollars. QuickBooks reports a remainder in dollars;
 * `applyInvoiceStatusFromQBO` converts it once, so no adapter has to know the
 * QBO shape or repeat the arithmetic. See #273.
 */
export type MarkPartialFn = (invoiceId: string, amountPaidCents: number, tenantId: string) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

export class QBOServiceBase {
    constructor(
        protected db: D1Database,
        protected clientId: string,
        protected clientSecret: string,
        protected webhookSecret: string,
        protected jwtSecret: string,
        /**
         * `QBO_ENV` verbatim, resolved lazily rather than in the constructor:
         * the service is built for every request that touches an invoice, and
         * a deployment with no QuickBooks connection at all should not fail on
         * construction for a setting it never uses.
         */
        protected qboEnv?: string,
    ) {}

    /** Throws when `QBO_ENV` is unset or unknown — no host is guessed. */
    protected get apiBase(): string { return resolveQboApiBase(this.qboEnv); }

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

        if (row.tokenExpiresAt.getTime() - Date.now() < 300_000) {
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
        const nowMs = Date.now();

        await db.update(qboConnections).set({
            accessToken:           await encryptToken(data.access_token, this.jwtSecret),
            refreshToken:          await encryptToken(data.refresh_token, this.jwtSecret),
            tokenExpiresAt:        new Date(nowMs + ACCESS_TOKEN_TTL_SEC * 1000),
            refreshTokenExpiresAt: new Date(nowMs + data.x_refresh_token_expires_in * 1000),
        }).where(eq(qboConnections.tenantId, tenantId));

        return { accessToken: data.access_token, realmId: row.realmId, tenantId };
    }

    protected async apiCall<T>(
        tenantId: string,
        method: 'GET' | 'POST' | 'PUT',
        path: string,
        body?: unknown,
    ): Promise<T> {
        // Resolved before the token, so a misconfigured QBO_ENV surfaces
        // without first spending a refresh round-trip on Intuit.
        const base = this.apiBase;
        const { accessToken, realmId } = await this.getToken(tenantId);
        const separator = path.includes('?') ? '&' : '?';
        const url = `${base}/${realmId}/${path}${separator}minorversion=${MINOR_VERSION}`;

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
        const msg = error instanceof Error ? error.message : String(error);
        await this.upsertSyncFlag(tenantId, oiType, oiId, 'SYNC_ERROR', msg);
    }

    /**
     * QuickBooks and our ledger disagree about what was collected. Recorded, not
     * corrected: an adjusting entry would manufacture money movement nobody
     * performed, and a human reconciles money. Re-detecting the same
     * disagreement refreshes the figures instead of stacking rows.
     */
    protected async recordPaymentDiscrepancy(
        tenantId: string, invoiceId: string, ledgerCents: number, qboCents: number,
    ): Promise<void> {
        await this.upsertSyncFlag(
            tenantId, 'invoice', invoiceId, QBO_PAYMENT_DISCREPANCY,
            encodePaymentDiscrepancy({ ledgerCents, qboCents }),
        );
    }

    /** The two sides agree again — whoever reconciled it does not have to also tick it off. */
    protected async clearPaymentDiscrepancy(tenantId: string, invoiceId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(qboSyncErrors).set({ resolved: true, updatedAt: new Date() })
            .where(and(
                eq(qboSyncErrors.tenantId, tenantId),
                eq(qboSyncErrors.oiType, 'invoice'),
                eq(qboSyncErrors.oiId, invoiceId),
                eq(qboSyncErrors.errorCode, QBO_PAYMENT_DISCREPANCY),
                eq(qboSyncErrors.resolved, false),
            ));
    }

    /**
     * One open row per (entity, kind). `errorCode` is part of the identity: a
     * failed push and a payment discrepancy on the same invoice are two
     * different things to look at, and collapsing them would overwrite one
     * with the other.
     */
    private async upsertSyncFlag(
        tenantId: string, oiType: string, oiId: string, errorCode: string, errorMsg: string,
    ): Promise<void> {
        const db = this.getDrizzle();
        const now = new Date();
        const existing = await db.select().from(qboSyncErrors)
            .where(and(
                eq(qboSyncErrors.tenantId, tenantId),
                eq(qboSyncErrors.oiType, oiType),
                eq(qboSyncErrors.oiId, oiId),
                eq(qboSyncErrors.errorCode, errorCode),
                eq(qboSyncErrors.resolved, false),
            )).get();

        if (existing) {
            await db.update(qboSyncErrors).set({
                retries:   existing.retries + 1,
                errorMsg,
                updatedAt: now,
            }).where(and(
                eq(qboSyncErrors.tenantId, tenantId),
                eq(qboSyncErrors.id, existing.id),
            ));
        } else {
            await db.insert(qboSyncErrors).values({
                id:        crypto.randomUUID(),
                tenantId,
                oiType,
                oiId,
                errorCode,
                errorMsg,
                retries:   0,
                resolved:  false,
                createdAt: now,
                updatedAt: now,
            });
        }
    }
}
