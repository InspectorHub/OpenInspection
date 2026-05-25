import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap, qboSyncErrors } from '../lib/db/schema/qbo';
import { invoices } from '../lib/db/schema/invoice';
import { encryptToken, decryptToken } from '../lib/qbo-crypto';
import { logger } from '../lib/logger';
import { QBOTokenResponseSchema, QBOCloudEventSchema, type QBOCloudEvent } from '../lib/validations/qbo.schema';

const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR_VERSION = '75';
const ACCESS_TOKEN_TTL_SEC = 3600;
const CDC_PAGE_SIZE = 1000;

export interface QBOConnectionStatus {
    realmId: string;
    companyName: string | null;
    lastSyncAt: number | null;
    syncEnabled: boolean;
    openErrors: number;
    refreshTokenExpiresAt: number;
}

type QBOToken = {
    accessToken: string;
    realmId: string;
    tenantId: string;
};

type InvoiceSummary = { Id: string; SyncToken: string; Balance: number; TotalAmt: number };

type MarkPaidFn = (invoiceId: string, tenantId: string) => Promise<void>;
type MarkPartialFn = (invoiceId: string, balance: number, tenantId: string) => Promise<void>;

export class QBOService {
    constructor(
        private db: D1Database,
        private clientId: string,
        private clientSecret: string,
        private webhookSecret: string,
        private jwtSecret: string,
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    private buildBasicAuth(): string {
        return 'Basic ' + btoa(`${this.clientId}:${this.clientSecret}`);
    }

    private parseCloudEventType(type: string): { entityType: string; operation: string } | null {
        const parts = type.split('.');
        if (parts.length < 4 || parts[0] !== 'qbo') return null;
        return { entityType: parts[1]!, operation: parts[2]! };
    }

    private async verifyWebhookSignature(rawBody: string, headerSig: string): Promise<boolean> {
        try {
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
                'raw',
                encoder.encode(this.webhookSecret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign'],
            );
            const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
            const computed = btoa(Array.from(new Uint8Array(sig), b => String.fromCharCode(b)).join(''));
            return computed === headerSig;
        } catch {
            return false;
        }
    }

    private toIso8601(unixSeconds: number): string {
        return new Date(unixSeconds * 1000).toISOString();
    }

    private buildDocNumber(invoiceNumber: string): string {
        return invoiceNumber.slice(0, 21);
    }

    private async getToken(tenantId: string): Promise<QBOToken> {
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

    private async refreshToken(tenantId: string): Promise<QBOToken> {
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

    private async revokeToken(tenantId: string): Promise<void> {
        try {
            const db = this.getDrizzle();
            const row = await db.select().from(qboConnections)
                .where(eq(qboConnections.tenantId, tenantId)).get();
            if (!row) return;
            const refreshToken = await decryptToken(row.refreshToken, this.jwtSecret);
            await fetch(QBO_REVOKE_URL, {
                method: 'POST',
                headers: {
                    Authorization: this.buildBasicAuth(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ token: refreshToken }),
            });
        } catch (e) {
            logger.error('QBO revokeToken failed (non-fatal)', {}, e instanceof Error ? e : undefined);
        }
    }

    private async apiCall<T>(
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

    private async qboQuery<T>(tenantId: string, query: string): Promise<T> {
        return this.apiCall<T>(tenantId, 'GET', `query?query=${encodeURIComponent(query)}`);
    }

    private async logSyncError(tenantId: string, oiType: string, oiId: string, error: unknown): Promise<void> {
        const db = this.getDrizzle();
        const now = Math.floor(Date.now() / 1000);
        const msg = error instanceof Error ? error.message : String(error);
        const existing = await db.select().from(qboSyncErrors)
            .where(and(
                eq(qboSyncErrors.tenantId, tenantId),
                eq(qboSyncErrors.oiType, oiType),
                eq(qboSyncErrors.oiId, oiId),
                eq(qboSyncErrors.resolved, 0),
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
                resolved:  0,
                createdAt: now,
                updatedAt: now,
            });
        }
    }

    // Raw SQL because Drizzle does not type the cross-table join we need.
    private async getQBOCustomerIdForInvoice(tenantId: string, invoiceId: string): Promise<string | null> {
        const row = await this.db.prepare(
            `SELECT qem_c.qbo_id AS qbo_customer_id
             FROM invoices inv
             JOIN qbo_entity_map qem_c
               ON qem_c.oi_id = inv.contact_id
              AND qem_c.tenant_id = inv.tenant_id
              AND qem_c.oi_type = 'contact'
             WHERE inv.id = ? AND inv.tenant_id = ?
             LIMIT 1`,
        ).bind(invoiceId, tenantId).first<{ qbo_customer_id: string }>().catch(() => null);
        return row?.qbo_customer_id ?? null;
    }

    private async applyInvoiceStatusFromQBO(
        tenantId: string,
        inv: InvoiceSummary,
        markPaid: MarkPaidFn,
        markPartial: MarkPartialFn,
    ): Promise<boolean> {
        const db = this.getDrizzle();
        const mapped = await db.select().from(qboEntityMap).where(
            and(
                eq(qboEntityMap.tenantId, tenantId),
                eq(qboEntityMap.qboType, 'Invoice'),
                eq(qboEntityMap.qboId, inv.Id),
            ),
        ).get();
        if (!mapped) return false;

        await db.update(qboEntityMap).set({
            qboSyncToken: inv.SyncToken,
            syncedAt:     Math.floor(Date.now() / 1000),
        }).where(eq(qboEntityMap.id, mapped.id));

        if (inv.Balance === 0) {
            await markPaid(mapped.oiId, tenantId);
        } else if (inv.Balance < inv.TotalAmt) {
            await markPartial(mapped.oiId, inv.Balance, tenantId);
        }
        return true;
    }

    // ─── Connection lifecycle ─────────────────────────────────────────────────

    async saveConnection(input: {
        tenantId: string;
        realmId: string;
        companyName: string | null;
        accessToken: string;
        refreshToken: string;
        refreshTokenExpiresIn: number;
    }): Promise<void> {
        const db = this.getDrizzle();
        const now = Math.floor(Date.now() / 1000);
        const [encAccess, encRefresh] = await Promise.all([
            encryptToken(input.accessToken, this.jwtSecret),
            encryptToken(input.refreshToken, this.jwtSecret),
        ]);
        const baseValues = {
            realmId:               input.realmId,
            companyName:           input.companyName,
            accessToken:           encAccess,
            refreshToken:          encRefresh,
            tokenExpiresAt:        now + ACCESS_TOKEN_TTL_SEC,
            refreshTokenExpiresAt: now + input.refreshTokenExpiresIn,
        };
        await db.insert(qboConnections).values({
            tenantId:      input.tenantId,
            syncEnabled:   1,
            defaultItemId: '1',
            createdAt:     now,
            ...baseValues,
        }).onConflictDoUpdate({
            target: qboConnections.tenantId,
            set:    baseValues,
        });
    }

    async setSyncEnabled(tenantId: string): Promise<boolean | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
        if (!row) return null;
        const newEnabled = row.syncEnabled === 1 ? 0 : 1;
        await db.update(qboConnections).set({ syncEnabled: newEnabled })
            .where(eq(qboConnections.tenantId, tenantId));
        return newEnabled === 1;
    }

    async resolveError(tenantId: string, errorId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(qboSyncErrors).set({ resolved: 1 })
            .where(and(eq(qboSyncErrors.id, errorId), eq(qboSyncErrors.tenantId, tenantId)));
    }

    // ─── Item Bootstrap ───────────────────────────────────────────────────────

    private buildDisplayName(
        firstName: string,
        lastName: string,
        email: string | null,
        retry: number,
        contactId?: string,
    ): string {
        const base = `${firstName} ${lastName}`.trim() || 'Unknown';
        if (retry === 0) return base;
        if (retry === 1 && email) return `${base} (${email})`;
        return `${base} (${contactId ?? 'unknown'})`;
    }

    async bootstrapDefaultItem(tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        let result = await this.qboQuery<{ QueryResponse: { Item?: Array<{ Id: string }> } }>(
            tenantId,
            `SELECT * FROM Item WHERE Name = 'Services' AND Active = true MAXRESULTS 1`,
        ).catch(() => null);

        let itemId = result?.QueryResponse?.Item?.[0]?.Id ?? null;

        if (!itemId) {
            result = await this.qboQuery<{ QueryResponse: { Item?: Array<{ Id: string }> } }>(
                tenantId,
                `SELECT * FROM Item WHERE Type = 'Service' AND Active = true ORDERBY Id MAXRESULTS 1`,
            ).catch(() => null);
            itemId = result?.QueryResponse?.Item?.[0]?.Id ?? null;
        }

        if (!itemId) {
            logger.error('QBO: no Service item found — invoice sync blocked', { tenantId });
            await this.logSyncError(tenantId, 'invoice', 'bootstrap', new Error('No QBO Service item found'));
            return;
        }

        await db.update(qboConnections).set({ defaultItemId: itemId })
            .where(eq(qboConnections.tenantId, tenantId));
        logger.info('QBO: bootstrapped default item', { tenantId, itemId });
    }

    // ─── Customer Sync ────────────────────────────────────────────────────────

    async upsertCustomer(
        tenantId: string,
        contact: {
            id: string;
            name: string;
            email?: string | null;
            phone?: string | null;
            agency?: string | null;
        },
    ): Promise<void> {
        const db = this.getDrizzle();
        const nameParts = contact.name.trim().split(' ');
        const firstName = nameParts[0] ?? '';
        const lastName = nameParts.slice(1).join(' ') || firstName;

        const buildPayload = (displayName: string) => ({
            DisplayName:      displayName,
            GivenName:        firstName,
            FamilyName:       lastName,
            CompanyName:      contact.agency ?? undefined,
            PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
            PrimaryPhone:     contact.phone ? { FreeFormNumber: contact.phone } : undefined,
        });

        const existing = await db.select().from(qboEntityMap).where(
            and(
                eq(qboEntityMap.tenantId, tenantId),
                eq(qboEntityMap.oiType, 'contact'),
                eq(qboEntityMap.oiId, contact.id),
            ),
        ).get();

        try {
            if (existing) {
                const displayName = this.buildDisplayName(firstName, lastName, contact.email ?? null, 0);
                const updated = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                    tenantId, 'PUT', 'customer',
                    { ...buildPayload(displayName), Id: existing.qboId, SyncToken: existing.qboSyncToken },
                );
                await db.update(qboEntityMap).set({
                    qboSyncToken: updated.Customer.SyncToken,
                    syncedAt:     Math.floor(Date.now() / 1000),
                }).where(eq(qboEntityMap.id, existing.id));
                return;
            }

            if (contact.email) {
                const found = await this.qboQuery<{ QueryResponse: { Customer?: Array<{ Id: string; SyncToken: string; DisplayName: string }> } }>(
                    tenantId,
                    `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${contact.email.replace(/'/g, "\\'")}' MAXRESULTS 5`,
                );
                const matches = found.QueryResponse.Customer ?? [];
                const match = matches[0];
                if (match) {
                    const now = Math.floor(Date.now() / 1000);
                    await db.insert(qboEntityMap).values({
                        id: crypto.randomUUID(), tenantId,
                        oiType: 'contact', oiId: contact.id,
                        qboType: 'Customer', qboId: match.Id,
                        qboSyncToken: match.SyncToken, syncedAt: now,
                    });
                    if (matches.length > 1) {
                        logger.info('QBO: multiple customers found by email — using first', {
                            tenantId, contactId: contact.id, count: matches.length,
                        });
                    }
                    await this.apiCall(tenantId, 'PUT', 'customer', {
                        ...buildPayload(match.DisplayName), Id: match.Id, SyncToken: match.SyncToken,
                    });
                    return;
                }
            }

            for (let retry = 0; retry <= 2; retry++) {
                const displayName = this.buildDisplayName(firstName, lastName, contact.email ?? null, retry, contact.id);
                try {
                    const created = await this.apiCall<{ Customer: { Id: string; SyncToken: string } }>(
                        tenantId, 'POST', 'customer', buildPayload(displayName),
                    );
                    const now = Math.floor(Date.now() / 1000);
                    await db.insert(qboEntityMap).values({
                        id: crypto.randomUUID(), tenantId,
                        oiType: 'contact', oiId: contact.id,
                        qboType: 'Customer', qboId: created.Customer.Id,
                        qboSyncToken: created.Customer.SyncToken, syncedAt: now,
                    });
                    return;
                } catch (err: unknown) {
                    const qboErr = err as { qboResponse?: { Fault?: { Error?: Array<{ code?: string }> } } };
                    // 6140 = "Duplicate Name Exists Error" — retry with a disambiguated DisplayName
                    const code = qboErr?.qboResponse?.Fault?.Error?.[0]?.code;
                    if (code === '6140' && retry < 2) continue;
                    throw err;
                }
            }
        } catch (e) {
            logger.error('QBO upsertCustomer failed', { tenantId, contactId: contact.id }, e instanceof Error ? e : undefined);
            await this.logSyncError(tenantId, 'contact', contact.id, e);
        }
    }

    // ─── Invoice Sync ─────────────────────────────────────────────────────────

    async upsertInvoice(
        tenantId: string,
        invoice: {
            id: string;
            invoiceNumber?: string | null;
            contactId?: string | null;
            dueDate?: string | null;
            lineItems: Array<{ description: string; amountCents: number; quantity?: number }>;
            status: string;
        },
    ): Promise<void> {
        const db = this.getDrizzle();
        const conn = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
        if (!conn) return;

        let qboCustomerId: string | null = null;
        if (invoice.contactId) {
            const contactMap = await db.select().from(qboEntityMap).where(
                and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'contact'), eq(qboEntityMap.oiId, invoice.contactId)),
            ).get();
            qboCustomerId = contactMap?.qboId ?? null;
        }

        const today = new Date().toISOString().slice(0, 10);
        const dueDate = invoice.dueDate ? invoice.dueDate.slice(0, 10) : today;

        const lines = invoice.lineItems.map(item => {
            const qty = item.quantity ?? 1;
            return {
                DetailType: 'SalesItemLineDetail',
                Amount:     item.amountCents / 100,
                SalesItemLineDetail: {
                    ItemRef:   { value: conn.defaultItemId, name: item.description.slice(0, 100) },
                    UnitPrice: item.amountCents / 100 / qty,
                    Qty:       qty,
                },
            };
        });

        const payload: Record<string, unknown> = {
            DocNumber:   this.buildDocNumber(invoice.invoiceNumber ?? invoice.id),
            TxnDate:     today,
            DueDate:     dueDate,
            Line:        lines,
            EmailStatus: invoice.status === 'sent' ? 'EmailSent' : 'NotSet',
        };
        if (qboCustomerId) payload.CustomerRef = { value: qboCustomerId };

        const existing = await db.select().from(qboEntityMap).where(
            and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoice.id)),
        ).get();

        try {
            if (existing) {
                let syncToken = existing.qboSyncToken;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const updated = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                            tenantId, 'PUT', 'invoice',
                            { ...payload, Id: existing.qboId, SyncToken: syncToken },
                        );
                        await db.update(qboEntityMap).set({
                            qboSyncToken: updated.Invoice.SyncToken,
                            syncedAt:     Math.floor(Date.now() / 1000),
                        }).where(eq(qboEntityMap.id, existing.id));
                        return;
                    } catch (err: unknown) {
                        // 400 typically indicates a stale SyncToken — refetch and retry
                        const qboErr = err as { status?: number };
                        if (qboErr?.status === 400) {
                            const refetched = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                                tenantId, 'GET', `invoice/${existing.qboId}`,
                            );
                            syncToken = refetched.Invoice.SyncToken;
                            continue;
                        }
                        throw err;
                    }
                }
            } else {
                const created = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                    tenantId, 'POST', 'invoice', payload,
                );
                const now = Math.floor(Date.now() / 1000);
                await db.insert(qboEntityMap).values({
                    id: crypto.randomUUID(), tenantId,
                    oiType: 'invoice', oiId: invoice.id,
                    qboType: 'Invoice', qboId: created.Invoice.Id,
                    qboSyncToken: created.Invoice.SyncToken, syncedAt: now,
                });
            }

            await db.update(invoices).set({ qboSyncStatus: 'synced' }).where(
                and(eq(invoices.id, invoice.id), eq(invoices.tenantId, tenantId)),
            );
        } catch (e) {
            await db.update(invoices).set({ qboSyncStatus: 'failed' }).where(
                and(eq(invoices.id, invoice.id), eq(invoices.tenantId, tenantId)),
            );
            logger.error('QBO upsertInvoice failed', { tenantId, invoiceId: invoice.id }, e instanceof Error ? e : undefined);
            await this.logSyncError(tenantId, 'invoice', invoice.id, e);
        }
    }

    async voidInvoice(tenantId: string, invoiceId: string): Promise<void> {
        const db = this.getDrizzle();
        const mapped = await db.select().from(qboEntityMap).where(
            and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoiceId)),
        ).get();
        if (!mapped) return;

        try {
            const voided = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                tenantId, 'POST', `invoice?operation=void`,
                { Id: mapped.qboId, SyncToken: mapped.qboSyncToken },
            );
            await db.update(qboEntityMap).set({
                qboSyncToken: voided.Invoice.SyncToken,
                syncedAt:     Math.floor(Date.now() / 1000),
            }).where(eq(qboEntityMap.id, mapped.id));
        } catch (e) {
            logger.error('QBO voidInvoice failed', { tenantId, invoiceId }, e instanceof Error ? e : undefined);
            await this.logSyncError(tenantId, 'invoice', invoiceId, e);
        }
    }

    async recordPayment(tenantId: string, invoiceId: string, amountPaid: number): Promise<void> {
        const db = this.getDrizzle();
        const invoiceMap = await db.select().from(qboEntityMap).where(
            and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoiceId)),
        ).get();
        if (!invoiceMap) return;

        const qboCustomerId = await this.getQBOCustomerIdForInvoice(tenantId, invoiceId);
        if (!qboCustomerId) {
            logger.info('QBO recordPayment: no customer mapping — skipping', { tenantId, invoiceId });
            return;
        }

        try {
            await this.apiCall(tenantId, 'POST', 'payment', {
                CustomerRef: { value: qboCustomerId },
                TotalAmt:    amountPaid,
                TxnDate:     new Date().toISOString().slice(0, 10),
                Line:        [{ Amount: amountPaid, LinkedTxn: [{ TxnId: invoiceMap.qboId, TxnType: 'Invoice' }] }],
            });
        } catch (e) {
            logger.error('QBO recordPayment failed', { tenantId, invoiceId }, e instanceof Error ? e : undefined);
            await this.logSyncError(tenantId, 'invoice', invoiceId, e);
        }
    }

    async createCreditMemo(tenantId: string, invoiceId: string, refundAmount: number): Promise<void> {
        const db = this.getDrizzle();
        const conn = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
        if (!conn) return;

        const qboCustomerId = await this.getQBOCustomerIdForInvoice(tenantId, invoiceId);
        if (!qboCustomerId) return;

        try {
            const created = await this.apiCall<{ CreditMemo: { Id: string; SyncToken: string } }>(
                tenantId, 'POST', 'creditmemo', {
                    CustomerRef: { value: qboCustomerId },
                    TxnDate:     new Date().toISOString().slice(0, 10),
                    Line:        [{
                        DetailType: 'SalesItemLineDetail',
                        Amount:     refundAmount,
                        SalesItemLineDetail: {
                            ItemRef:   { value: conn.defaultItemId },
                            UnitPrice: refundAmount,
                            Qty:       1,
                        },
                    }],
                },
            );
            const now = Math.floor(Date.now() / 1000);
            await db.insert(qboEntityMap).values({
                id:           crypto.randomUUID(),
                tenantId,
                oiType:       'refund',
                oiId:         invoiceId,
                qboType:      'CreditMemo',
                qboId:        created.CreditMemo.Id,
                qboSyncToken: created.CreditMemo.SyncToken,
                syncedAt:     now,
            });
        } catch (e) {
            logger.error('QBO createCreditMemo failed', { tenantId, invoiceId }, e instanceof Error ? e : undefined);
            await this.logSyncError(tenantId, 'refund', invoiceId, e);
        }
    }

    // ─── Inbound: Webhook ─────────────────────────────────────────────────────

    async handleWebhook(
        rawBody: string,
        headerSig: string,
        markPaid: MarkPaidFn,
        markPartial: MarkPartialFn,
    ): Promise<{ valid: boolean }> {
        const valid = await this.verifyWebhookSignature(rawBody, headerSig);
        if (!valid) return { valid: false };

        let raw: unknown;
        try {
            raw = JSON.parse(rawBody);
        } catch {
            return { valid: true };
        }

        const candidates = Array.isArray(raw) ? raw : [raw];
        const events: QBOCloudEvent[] = [];
        for (const c of candidates) {
            const parsed = QBOCloudEventSchema.safeParse(c);
            if (parsed.success) events.push(parsed.data);
        }

        const db = this.getDrizzle();
        for (const event of events) {
            const parsed = this.parseCloudEventType(event.type);
            if (!parsed || parsed.entityType !== 'invoice') continue;

            const conn = await db.select().from(qboConnections)
                .where(eq(qboConnections.realmId, event.intuitaccountid)).get();
            if (!conn) continue;

            try {
                const data = await this.apiCall<{ Invoice: InvoiceSummary }>(
                    conn.tenantId, 'GET', `invoice/${event.intuitentityid}`,
                );
                await this.applyInvoiceStatusFromQBO(conn.tenantId, data.Invoice, markPaid, markPartial);
            } catch (e) {
                logger.error('QBO webhook invoice processing failed',
                    { tenantId: conn.tenantId, entityId: event.intuitentityid },
                    e instanceof Error ? e : undefined);
            }
        }

        return { valid: true };
    }

    // ─── Inbound: CDC (Hourly Cron) ───────────────────────────────────────────

    async runCDCSync(
        tenantId: string,
        markPaid: MarkPaidFn,
        markPartial: MarkPartialFn,
    ): Promise<{ processed: number }> {
        const db = this.getDrizzle();
        const conn = await db.select().from(qboConnections)
            .where(and(eq(qboConnections.tenantId, tenantId), eq(qboConnections.syncEnabled, 1))).get();
        if (!conn) return { processed: 0 };

        const sinceIso = this.toIso8601(conn.lastSyncAt ?? conn.createdAt);
        let processed = 0;
        let startPosition = 1;

        while (true) {
            const query = `SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '${sinceIso}' STARTPOSITION ${startPosition} MAXRESULTS ${CDC_PAGE_SIZE}`;
            let result: { QueryResponse: { Invoice?: InvoiceSummary[] } };
            try {
                result = await this.qboQuery(tenantId, query);
            } catch (e) {
                logger.error('QBO CDC query failed', { tenantId }, e instanceof Error ? e : undefined);
                break;
            }

            const invoiceList = result.QueryResponse.Invoice ?? [];
            for (const inv of invoiceList) {
                const applied = await this.applyInvoiceStatusFromQBO(tenantId, inv, markPaid, markPartial);
                if (applied) processed++;
                await new Promise(r => setTimeout(r, 100));
            }

            if (invoiceList.length < CDC_PAGE_SIZE) break;
            startPosition += CDC_PAGE_SIZE;
        }

        await db.update(qboConnections).set({ lastSyncAt: Math.floor(Date.now() / 1000) })
            .where(eq(qboConnections.tenantId, tenantId));

        return { processed };
    }

    async getConnectionStatus(tenantId: string): Promise<QBOConnectionStatus | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(qboConnections)
            .where(eq(qboConnections.tenantId, tenantId)).get();
        if (!row) return null;
        const errorRows = await db.select().from(qboSyncErrors)
            .where(and(eq(qboSyncErrors.tenantId, tenantId), eq(qboSyncErrors.resolved, 0))).all();
        return {
            realmId:               row.realmId,
            companyName:           row.companyName,
            lastSyncAt:            row.lastSyncAt,
            syncEnabled:           row.syncEnabled === 1,
            openErrors:            errorRows.length,
            refreshTokenExpiresAt: row.refreshTokenExpiresAt,
        };
    }

    async disconnect(tenantId: string): Promise<void> {
        await this.revokeToken(tenantId);
        const db = this.getDrizzle();
        await db.delete(qboEntityMap).where(eq(qboEntityMap.tenantId, tenantId));
        await db.delete(qboConnections).where(eq(qboConnections.tenantId, tenantId));
    }

    async linkExistingCustomer(tenantId: string, contactId: string, qboCustomerId: string): Promise<void> {
        const db = this.getDrizzle();
        const now = Math.floor(Date.now() / 1000);
        await db.insert(qboEntityMap).values({
            id:           crypto.randomUUID(),
            tenantId,
            oiType:       'contact',
            oiId:         contactId,
            qboType:      'Customer',
            qboId:        qboCustomerId,
            qboSyncToken: '0',
            syncedAt:     now,
        }).onConflictDoUpdate({
            target: [qboEntityMap.tenantId, qboEntityMap.oiType, qboEntityMap.oiId],
            set:    { qboId: qboCustomerId, syncedAt: now },
        });
    }
}
