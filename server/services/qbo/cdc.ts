import { eq, and } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import {
    CDC_PAGE_SIZE,
    type Constructor,
    type InvoiceSummary,
    type MarkPaidFn,
    type MarkPartialFn,
    type QBOServiceBase,
} from './api-base';
import { withInvoiceSync } from './invoice-sync';

export function withCdc<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends withInvoiceSync(Base) {
        protected toIso8601(when: Date): string {
            return when.toISOString();
        }

        async runCDCSync(
            tenantId: string,
            markPaid: MarkPaidFn,
            markPartial: MarkPartialFn,
        ): Promise<{ processed: number }> {
            const db = this.getDrizzle();
            const conn = await db.select().from(qboConnections)
                .where(and(eq(qboConnections.tenantId, tenantId), eq(qboConnections.syncEnabled, true))).get();
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

            await db.update(qboConnections).set({ lastSyncAt: new Date() })
                .where(eq(qboConnections.tenantId, tenantId));

            return { processed };
        }
    };
}
