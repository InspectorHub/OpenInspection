import { eq } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import { type Constructor, type QBOServiceBase } from './api-base';

export function withBootstrap<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
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
    };
}
