/**
 * Communication section header counts for the /hub aggregate (plan A1.2) — in
 * the aggregate so the section renders its summary line without a second round
 * trip.
 *
 * Only DUE deliveries count (send_at <= now): a delayed automation's pending
 * rows are a plan, not a state anyone needs alerting to. "Unread" is anything
 * not inspector-authored, matching MessageService.unreadCountForTenant —
 * a client-only filter would leave agent messages permanently uncounted.
 */
import { and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { automationLogs, automations, inspectionMessages } from './db/schema';

export interface CommunicationCounts {
    delivered: number;
    needsAttention: number;
    unread: number;
    /**
     * Active automation rules in the tenant — lets the Outbox tell its three
     * empty states apart (report unpublished / no rules / nothing sent yet),
     * which look identical and mean opposite things.
     */
    rulesActive: number;
}

export async function communicationCounts(
    // Accepts any drizzle sqlite handle (D1 in production, better-sqlite3 in
    // unit tests) — the queries only use portable core builders.
    db: Pick<DrizzleD1Database, 'select'>,
    tenantId: string,
    inspectionId: string,
    now: Date = new Date(),
): Promise<CommunicationCounts> {
    const [deliveryCounts, unreadRow, rulesRow] = await Promise.all([
        db.select({
            delivered: sql<number>`sum(case when ${automationLogs.status} = 'sent' then 1 else 0 end)`,
            needsAttention: sql<number>`sum(case when ${automationLogs.status} in ('failed', 'skipped') then 1 else 0 end)`,
        }).from(automationLogs)
            .where(and(
                eq(automationLogs.tenantId, tenantId),
                eq(automationLogs.inspectionId, inspectionId),
                lte(automationLogs.sendAt, now),
            )).get(),
        db.select({ c: sql<number>`count(*)` }).from(inspectionMessages)
            .where(and(
                eq(inspectionMessages.tenantId, tenantId),
                eq(inspectionMessages.inspectionId, inspectionId),
                ne(inspectionMessages.fromRole, 'inspector'),
                isNull(inspectionMessages.readAt),
            )).get(),
        db.select({ c: sql<number>`count(*)` }).from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.active, true)))
            .get(),
    ]);
    return {
        delivered:      Number(deliveryCounts?.delivered ?? 0),
        needsAttention: Number(deliveryCounts?.needsAttention ?? 0),
        unread:         Number(unreadRow?.c ?? 0),
        rulesActive:    Number(rulesRow?.c ?? 0),
    };
}
