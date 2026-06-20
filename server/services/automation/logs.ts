import { eq, and, sql, desc } from 'drizzle-orm';
import { automationLogs } from '../../lib/db/schema';
import { type Constructor } from './shared';
import type { AutomationBase } from './shared';

/**
 * Logs mixin: read-only queries over automation_logs (per-inspection history +
 * recent-log feed). Bodies are byte-identical to the former monolith.
 */
export function AutomationLogs<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        async getLogs(tenantId: string, inspectionId: string) {
            const db = this.getDrizzle();
            return db.select().from(automationLogs)
                .where(and(eq(automationLogs.tenantId, tenantId), eq(automationLogs.inspectionId, inspectionId)))
                .orderBy(sql`${automationLogs.sendAt} desc`);
        }

        async listRecentLogs(tenantId: string, limit = 50) {
            const db = this.getDrizzle();
            return await db.select()
                .from(automationLogs)
                .where(eq(automationLogs.tenantId, tenantId))
                .orderBy(desc(automationLogs.sendAt))
                .limit(limit);
        }
    };
}
