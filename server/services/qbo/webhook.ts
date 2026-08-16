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
            let notInvoice = 0;
            let unknownRealm = 0;
            for (const event of events) {
                const parsed = this.parseCloudEventType(event.type);
                if (!parsed || parsed.entityType !== 'invoice') { notInvoice++; continue; }

                const conn = await db.select().from(qboConnections)
                    .where(eq(qboConnections.realmId, event.intuitaccountid)).get();
                if (!conn) { unknownRealm++; continue; }

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

            // Both numbers, always: a count of what was dropped is not evidence
            // when the denominator is invisible — it cannot tell "one of four"
            // from "one of one". `unparsed > 0` in particular means Intuit's
            // payload shape no longer matches our schema, which used to surface
            // as a perfectly healthy-looking {valid:true} that processed nothing.
            if (unparsed > 0 || notInvoice > 0 || unknownRealm > 0) {
                logger.warn('QBO webhook dropped events', {
                    received: candidates.length,
                    handled:  events.length - notInvoice - unknownRealm,
                    unparsed,
                    notInvoice,
                    unknownRealm,
                });
            }

            return { valid: true };
        }
    };
}
