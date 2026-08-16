import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap, qboSyncErrors } from '../../lib/db/schema/qbo';
import { encryptToken, decryptToken } from '../../lib/qbo-crypto';
import { QBOTokenResponseSchema } from '../../lib/validations/qbo.schema';
import { QBO_PAYMENT_DISCREPANCY, QBO_VOIDED_IN_QBO, encodePaymentDiscrepancy } from '../../lib/qbo-discrepancy';
import { describeQboError } from './error-detail';

export { describeQboError };

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
        public db: D1Database,
        public clientId: string,
        public clientSecret: string,
        public webhookSecret: string,
        public jwtSecret: string,
        /**
         * `QBO_ENV` verbatim, resolved lazily rather than in the constructor:
         * the service is built for every request that touches an invoice, and
         * a deployment with no QuickBooks connection at all should not fail on
         * construction for a setting it never uses.
         */
        public qboEnv?: string,
    ) {}

    /** Throws when `QBO_ENV` is unset or unknown — no host is guessed. */
    public get apiBase(): string { return resolveQboApiBase(this.qboEnv); }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getDrizzle() { return drizzle(this.db as any); }

    public buildBasicAuth(): string {
        return 'Basic ' + btoa(`${this.clientId}:${this.clientSecret}`);
    }

    public async getToken(tenantId: string): Promise<QBOToken> {
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

    /**
     * Everything that stops being true when a connection ends.
     *
     * Two paths retire one: the tenant clicking Disconnect, and Intuit refusing
     * the grant. They must leave the same thing behind, and they used to
     * disagree — the refusal path dropped only the connection row.
     *
     * What survives is not clutter. The next authorization can land on a
     * DIFFERENT QuickBooks company, and a mapping that outlived its connection
     * still names entity ids belonging to the old one; the first invoice push
     * would then address a customer in books we no longer hold. Open errors
     * are the milder half — they reappear on reconnect describing a company
     * nobody is connected to.
     *
     * It lives on the base class because `refreshToken` is here and
     * `disconnect()` is in the connection mixin above it: only the base is
     * reachable from both.
     */
    public async retireConnection(tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.delete(qboEntityMap).where(eq(qboEntityMap.tenantId, tenantId));
        await db.delete(qboSyncErrors).where(eq(qboSyncErrors.tenantId, tenantId));
        await db.delete(qboConnections).where(eq(qboConnections.tenantId, tenantId));
    }

    public async refreshToken(tenantId: string): Promise<QBOToken> {
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
            // Only an explicit refusal of the grant is terminal.
            //
            // Intuit rotates the refresh token every 24-26 hours, so this path
            // runs on every connected tenant every day. Treating any non-2xx as
            // "reauthorize required" meant a single Intuit 5xx or a rate limit
            // permanently disconnected a paying customer and sent an owner back
            // through the whole OAuth flow — for an outage that had nothing to
            // say about their token. 400 (`invalid_grant`) and 401 are the
            // answers that DO say the token is dead; everything else leaves it
            // intact so the next attempt can use it.
            //
            // Intuit also began returning a field on this response that dates
            // the refresh token's hard expiry. It is deliberately not read
            // here: the exact key was not verifiable at the time of writing,
            // and keying a destructive delete off a guessed field name would
            // reintroduce the same failure it is supposed to prevent. The
            // status code already distinguishes the two cases; the field would
            // only let us disconnect EARLIER, which is not the useful direction.
            if (resp.status === 400 || resp.status === 401) {
                await this.retireConnection(tenantId);
                throw new Error('QBO refresh token rejected — reconnect required');
            }
            throw new Error(`QBO token refresh failed with ${resp.status} — connection left intact`);
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

    public async apiCall<T>(
        tenantId: string,
        /**
         * No PUT. QuickBooks v3 answers a PUT with
         * `"No resource method found for PUT"` — an UPDATE is a POST to the
         * same entity path carrying `Id` and `SyncToken`. Narrowing the union
         * is what stops the next person reaching for the verb their instincts
         * expect; see the note on the update paths.
         */
        method: 'GET' | 'POST',
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

        /**
         * Upper bound on a single throttle wait. Intuit may ask for more — it
         * does not know it is talking to a Worker — and a Worker cannot give
         * it: the request would die still holding the wait, having retried
         * nothing and told the tenant nothing. Failing is the better answer.
         */
        const MAX_RETRY_AFTER_MS = 30_000;

        /**
         * Each failure branch owns its own wait, deliberately. A sleep at the
         * top of the loop applies to EVERY retry, including one a 429 has
         * already waited out, so the interval Intuit named was silently doubled
         * by our backoff. It also fires before an attempt that will never
         * happen, spending budget on nothing — hence the `attempt < 2` guard.
         */
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const resp = await fetch(url, opts);
            if (resp.ok) return resp.json() as T;

            if (resp.status === 429) {
                const header = parseInt(resp.headers.get('Retry-After') ?? '', 10);
                const waitMs = Math.min(
                    Number.isFinite(header) ? header * 1000 : 2 ** attempt * 500,
                    MAX_RETRY_AFTER_MS,
                );
                // Named, so exhausting the retries reports throttling rather
                // than a generic failure the caller cannot act on.
                lastError = Object.assign(new Error('QBO 429'), { status: 429 });
                if (attempt < 2) await new Promise(r => setTimeout(r, waitMs));
                continue;
            }

            if (resp.status >= 500) {
                // Same shape as the 4xx throw below — callers branch on `status`.
                lastError = Object.assign(new Error(`QBO ${resp.status}`), { status: resp.status });
                if (attempt < 2) await new Promise(r => setTimeout(r, 2 ** attempt * 500));
                continue;
            }

            const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
            throw Object.assign(new Error(`QBO ${resp.status}`), { qboResponse: err, status: resp.status });
        }
        throw lastError ?? new Error('QBO API call failed after retries');
    }

    public async qboQuery<T>(tenantId: string, query: string): Promise<T> {
        return this.apiCall<T>(tenantId, 'GET', `query?query=${encodeURIComponent(query)}`);
    }


    public async logSyncError(tenantId: string, oiType: string, oiId: string, error: unknown): Promise<void> {
        await this.upsertSyncFlag(tenantId, oiType, oiId, 'SYNC_ERROR', describeQboError(error));
    }

    /**
     * QuickBooks and our ledger disagree about what was collected. Recorded, not
     * corrected: an adjusting entry would manufacture money movement nobody
     * performed, and a human reconciles money. Re-detecting the same
     * disagreement refreshes the figures instead of stacking rows.
     */
    public async recordPaymentDiscrepancy(
        tenantId: string, invoiceId: string, ledgerCents: number, qboCents: number,
    ): Promise<void> {
        await this.upsertSyncFlag(
            tenantId, 'invoice', invoiceId, QBO_PAYMENT_DISCREPANCY,
            encodePaymentDiscrepancy({ ledgerCents, qboCents }),
        );
    }

    /**
     * QuickBooks reports the document as worth nothing — voided on their side.
     *
     * Recorded, never applied. Mirroring a void inbound would reset this
     * inspection's payment gate and retract a published report on the strength
     * of a poll; voiding is a decision, not a reading. The sweep's job here is
     * to make sure a human finds out.
     */
    public async noteVoidedInQuickBooks(tenantId: string, invoiceId: string): Promise<void> {
        await this.upsertSyncFlag(
            tenantId, 'invoice', invoiceId, QBO_VOIDED_IN_QBO,
            'Voided in QuickBooks. OpenInspection left this invoice unchanged — '
            + 'void it here too if that was intended.',
        );
    }

    /** The two sides agree again — whoever reconciled it does not have to also tick it off. */
    public async clearPaymentDiscrepancy(tenantId: string, invoiceId: string): Promise<void> {
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
    public async upsertSyncFlag(
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
