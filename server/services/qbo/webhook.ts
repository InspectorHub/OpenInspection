import { eq } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import { QBOCloudEventSchema, type QBOCloudEvent } from '../../lib/validations/qbo.schema';
import type {
    Constructor,
    InvoiceSummary,
    MarkPaidFn,
    MarkPartialFn,
    QBOServiceBase,
} from './api-base';
import { withInvoiceSync } from './invoice-sync';
import type { CustomerSyncSurface } from './customer-sync';

// The `CustomerSyncSurface` half of the bound is inherited from
// `withInvoiceSync` below, which creates a missing QuickBooks customer on
// demand. Stated here too so the requirement is visible where the composition
// is, not only where it is used.
export function withWebhook<
    TBase extends Constructor<QBOServiceBase & CustomerSyncSurface>,
>(Base: TBase) {
    return class extends withInvoiceSync(Base) {
        public parseCloudEventType(type: string): { entityType: string; operation: string } | null {
            const parts = type.split('.');
            if (parts.length < 4 || parts[0] !== 'qbo') return null;
            return { entityType: parts[1]!, operation: parts[2]! };
        }

        public async verifyWebhookSignature(rawBody: string, headerSig: string): Promise<boolean> {
            try {
                const encoder = new TextEncoder();
                const key = await crypto.subtle.importKey(
                    'raw',
                    encoder.encode(this.webhookSecret),
                    { name: 'HMAC', hash: 'SHA-256' },
                    false,
                    ['verify'],
                );
                // crypto.subtle.verify compares in constant time. The previous
                // `computed === headerSig` short-circuited on the first
                // differing character, leaking timing on a verifier that is
                // reachable from the open internet.
                const sigBytes = Uint8Array.from(atob(headerSig), ch => ch.charCodeAt(0));
                return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(rawBody));
            } catch {
                // A header that is not valid base64 lands here. Reject it — do
                // not throw: this runs behind an already-sent 200, so a throw
                // is unobserved and Intuit never retries it.
                return false;
            }
        }

        /**
         * The invoices a QuickBooks Payment settled.
         *
         * The shape is captured, not assumed — `SELECT * FROM Payment` against a
         * live sandbox on 2026-08-17 returned:
         *
         *     { "Id": "165", "TotalAmt": 30, "UnappliedAmt": 0,
         *       "Line": [ { "Amount": 30,
         *                   "LinkedTxn": [ { "TxnId": "162",
         *                                    "TxnType": "Invoice" } ] } ] }
         *
         * Two things a guess gets wrong. `LinkedTxn` is nested inside `Line`,
         * not at the top of the Payment — a top-level read finds nothing and
         * reports a payment that settled no invoices, which is indistinguishable
         * from a payment we correctly ignored. And a Payment carries MANY lines:
         * one cheque against three invoices is one event and three invoices to
         * re-read. `TxnType` is filtered because the same array also links
         * credit memos and deposits, which are not invoices.
         *
         * `UnappliedAmt` is deliberately not read: money sitting unapplied has
         * settled nothing, and inventing an invoice for it would be the same
         * class of error as the void that read as PAID IN FULL.
         */
        public async invoicesTouchedByPayment(tenantId: string, paymentId: string): Promise<string[]> {
            const data = await this.apiCall<{
                Payment?: { Line?: Array<{ LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }> }> };
            }>(tenantId, 'GET', `payment/${paymentId}`);

            const ids = (data.Payment?.Line ?? [])
                .flatMap((line) => line.LinkedTxn ?? [])
                .filter((txn) => txn.TxnType === 'Invoice' && !!txn.TxnId)
                .map((txn) => txn.TxnId!);

            if (ids.length === 0) {
                // Worth a line: a payment applied to nothing is legitimate (an
                // unapplied credit), but so is a shape change that silently
                // stops finding links. Saying which invoices were found — even
                // when none were — is what separates the two later.
                logger.info('QBO payment settled no invoices', { tenantId, paymentId });
            }
            return [...new Set(ids)];
        }

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
            let unparsed = 0;
            for (const c of candidates) {
                const parsed = QBOCloudEventSchema.safeParse(c);
                if (parsed.success) events.push(parsed.data); else unparsed++;
            }

            const db = this.getDrizzle();
            let ignoredEntity = 0;
            let unknownRealm = 0;
            let ambiguousRealm = 0;
            for (const event of events) {
                const parsed = this.parseCloudEventType(event.type);
                const entity = parsed?.entityType;
                if (entity !== 'invoice' && entity !== 'payment') { ignoredEntity++; continue; }

                // `.all()`, not `.get()`. This lookup IS the tenant decision for
                // an unauthenticated endpoint, and `realm_id` carries no unique
                // constraint — `tenant_id` is the primary key, so the table
                // permits two tenants to hold the same QuickBooks company. With
                // `.get()` a duplicate resolved to whichever row came back
                // first, which applied one company's payments, voids and
                // balance changes to an arbitrary tenant's books.
                //
                // Ambiguity is refused, not guessed. `saveConnection` now
                // refuses to create a second claim, but a database can already
                // hold one, and the wrong tenant is worse than no tenant: the
                // event is skipped, counted and named below so somebody can
                // untangle the two connections.
                const claimants = await db.select().from(qboConnections)
                    .where(eq(qboConnections.realmId, event.intuitaccountid)).all();
                if (claimants.length === 0) { unknownRealm++; continue; }
                if (claimants.length > 1) {
                    ambiguousRealm++;
                    logger.warn('QBO webhook realm is ambiguous — refusing to guess a tenant', {
                        realmId:  event.intuitaccountid,
                        claimants: claimants.length,
                        tenantIds: claimants.map((r) => r.tenantId),
                        entityId:  event.intuitentityid,
                    });
                    continue;
                }
                const conn = claimants[0]!;

                try {
                    // A payment names the invoices it settled; an invoice event
                    // names itself. Either way what gets applied is the INVOICE's
                    // state, re-read from QuickBooks — so a payment and a manual
                    // edit converge on the same reconciliation, discrepancy
                    // detection and void check instead of growing a second path.
                    const invoiceIds = entity === 'invoice'
                        ? [event.intuitentityid]
                        : await this.invoicesTouchedByPayment(conn.tenantId, event.intuitentityid);

                    for (const invoiceId of invoiceIds) {
                        const data = await this.apiCall<{ Invoice: InvoiceSummary }>(
                            conn.tenantId, 'GET', `invoice/${invoiceId}`,
                        );
                        await this.applyInvoiceStatusFromQBO(conn.tenantId, data.Invoice, markPaid, markPartial);
                    }
                } catch (e) {
                    logger.error('QBO webhook processing failed',
                        { tenantId: conn.tenantId, entity, entityId: event.intuitentityid },
                        e instanceof Error ? e : undefined);
                }
            }

            // Both numbers, always: a count of what was dropped is not evidence
            // when the denominator is invisible — it cannot tell "one of four"
            // from "one of one". `unparsed > 0` in particular means Intuit's
            // payload shape no longer matches our schema, which used to surface
            // as a perfectly healthy-looking {valid:true} that processed nothing.
            if (unparsed > 0 || ignoredEntity > 0 || unknownRealm > 0 || ambiguousRealm > 0) {
                logger.warn('QBO webhook dropped events', {
                    received: candidates.length,
                    handled:  events.length - ignoredEntity - unknownRealm - ambiguousRealm,
                    unparsed,
                    ignoredEntity,
                    unknownRealm,
                    ambiguousRealm,
                });
            }

            return { valid: true };
        }
    };
}
