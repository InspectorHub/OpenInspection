import { eq } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { decryptToken } from '../../lib/qbo-crypto';
import { logger } from '../../lib/logger';
import { QBO_REVOKE_URL, type Constructor, type QBOServiceBase } from './api-base';

export function withToken<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        protected async revokeToken(tenantId: string): Promise<void> {
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
    };
}
