import { eq } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import { QBOCloudEventSchema, type QBOCloudEvent } from '../../lib/validations/qbo.schema';
import {
    type Constructor,
    type InvoiceSummary,
    type MarkPaidFn,
    type MarkPartialFn,
    type QBOServiceBase,
} from './api-base';
import { withInvoiceSync } from './invoice-sync';

export function withWebhook<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends withInvoiceSync(Base) {
        protected parseCloudEventType(type: string): { entityType: string; operation: string } | null {
            const parts = type.split('.');
            if (parts.length < 4 || parts[0] !== 'qbo') return null;
            return { entityType: parts[1]!, operation: parts[2]! };
        }

        protected async verifyWebhookSignature(rawBody: string, headerSig: string): Promise<boolean> {
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
    };
}
