import { eq, and, sql, desc, lte } from 'drizzle-orm';
import { automationLogs, automations, contactRoleProfiles } from '../../lib/db/schema';
import type { Constructor } from './shared';
import type { AutomationBase } from './shared';

/** One delivery row in the Communication payload (design §2 / plan A1.1). */
export interface CommunicationDelivery {
    id: string;
    direction: 'out';
    channel: string;
    recipient: string;
    recipientContactId: string | null;
    roleKey: string | null;
    /** Display label; null when the role was deleted — the UI falls back to the raw key. */
    roleLabel: string | null;
    status: 'pending' | 'sent' | 'failed' | 'skipped';
    /** RAW stored reason string, untouched — the English mapping lives in the UI. */
    reasonCode: string | null;
    source: 'automation' | 'manual';
    automationId: string;
    /** Rule name for the notice row title; null when the rule was deleted. */
    automationName: string | null;
    sendAt: number;
    deliveredAt: number | null;
}

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

        /**
         * The Outbox half of the Communication payload — getLogs widened with
         * the role's display label. LEFT join deliberately: a log whose role
         * profile was later deleted still appears with its raw key, because a
         * missing row in an audit view is worse than an ugly one.
         *
         * `send_at <= now` keeps a delayed automation's rows out of the view
         * until they are due — a "pending" row dated tomorrow reads as a
         * failure, not a plan.
         */
        async getCommunicationDeliveries(tenantId: string, inspectionId: string, now = Date.now()): Promise<CommunicationDelivery[]> {
            const db = this.getDrizzle();
            const rows = await db.select({
                id: automationLogs.id,
                channel: automationLogs.channel,
                recipient: automationLogs.recipient,
                recipientContactId: automationLogs.recipientContactId,
                roleKey: automationLogs.recipientRoleKey,
                roleLabel: contactRoleProfiles.label,
                automationName: automations.name,
                status: automationLogs.status,
                error: automationLogs.error,
                automationId: automationLogs.automationId,
                sendAt: automationLogs.sendAt,
                deliveredAt: automationLogs.deliveredAt,
            })
                .from(automationLogs)
                // `active = 1` in the JOIN condition, for two reasons: the
                // tenant/key unique index only covers active rows, so an
                // inactive duplicate could fan the join out; and a deactivated
                // role IS the "deleted role" case — its log must fall back to
                // the raw key, not resurrect a retired label.
                .leftJoin(automations, and(
                    eq(automations.tenantId, automationLogs.tenantId),
                    eq(automations.id, automationLogs.automationId),
                ))
                .leftJoin(contactRoleProfiles, and(
                    eq(contactRoleProfiles.tenantId, automationLogs.tenantId),
                    eq(contactRoleProfiles.key, sql`${automationLogs.recipientRoleKey}`),
                    eq(contactRoleProfiles.active, true),
                ))
                .where(and(
                    eq(automationLogs.tenantId, tenantId),
                    eq(automationLogs.inspectionId, inspectionId),
                    lte(automationLogs.sendAt, new Date(now)),
                ))
                .orderBy(sql`${automationLogs.sendAt} desc`);
            return rows.map((r) => ({
                id: r.id,
                direction: 'out' as const,
                channel: r.channel,
                recipient: r.recipient,
                recipientContactId: r.recipientContactId ?? null,
                roleKey: r.roleKey ?? null,
                roleLabel: r.roleLabel ?? null,
                status: r.status,
                reasonCode: r.error ?? null,
                // Manual sends land in A2 with their own source stamp; until
                // then every row here came from an automation firing.
                source: 'automation' as const,
                automationId: r.automationId,
                automationName: r.automationName ?? null,
                sendAt: r.sendAt instanceof Date ? r.sendAt.getTime() : Number(r.sendAt),
                deliveredAt: r.deliveredAt == null ? null : (r.deliveredAt instanceof Date ? r.deliveredAt.getTime() : Number(r.deliveredAt)),
            }));
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
