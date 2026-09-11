/**
 * Communication section header counts for the /hub aggregate (plan A1.2) — in
 * the aggregate so the section renders its summary line without a second round
 * trip.
 *
 * Only DUE deliveries count (send_at <= now): a delayed automation's pending
 * rows are a plan, not a state anyone needs alerting to. "Unread" is anything
 * not inspector-authored, matching MessageService.unreadCountForTenant —
 * a client-only filter would leave agent messages permanently uncounted.
 *
 * ## Why "pending" is not always a plan
 *
 * A pending row whose send time passed HOURS ago has stopped being a plan. The
 * summary line used to read `0 need attention` directly above five `0/1` rows
 * that had been due for over an hour — the roll-up contradicting the detail
 * printed beneath it, which is worse than having no roll-up: it actively tells
 * the inspector not to look. `failed` and `skipped` are rows the flush REACHED;
 * a long-overdue `pending` is a row it did not, and the inspector's interest in
 * the two is identical (the client has not got the report). So both are counted,
 * and `automation_logs.attempts` states the same thing from the other side: a
 * row pending with no error long past due can only mean flush never finished
 * with it.
 */
import { and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { automationLogs, automations, inspectionMessages } from './db/schema';

/**
 * How long a DUE delivery may sit `pending` before it counts as needing
 * attention.
 *
 * Three missed ticks of the five-minute cron that runs `automation-flush`. One
 * tick would make a normal in-flight minute look like an incident; an hour would
 * have kept the five stuck rows out of the roll-up for the whole window in which
 * somebody could still have rescued the delivery by hand. Exported so a test
 * asserts against the same number the query uses rather than a literal of its
 * own choosing.
 */
export const DELIVERY_OVERDUE_AFTER_MS = 15 * 60 * 1000;

export interface CommunicationCounts {
    delivered: number;
    /**
     * Deliveries the inspector has to do something about: the ones the flush
     * settled badly (`failed` / `skipped`) PLUS the ones it never settled at all
     * (`pending`, due more than DELIVERY_OVERDUE_AFTER_MS ago).
     */
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
    // The moment a still-pending delivery stops being "about to go out".
    const overdueBefore = new Date(now.getTime() - DELIVERY_OVERDUE_AFTER_MS);
    const [deliveryCounts, unreadRow, rulesRow] = await Promise.all([
        db.select({
            delivered: sql<number>`sum(case when ${automationLogs.status} = 'sent' then 1 else 0 end)`,
            // Built with `lte` rather than an inline comparison so the threshold
            // goes through the column's own timestamp mapping — the same reason
            // the outer `where` uses it.
            needsAttention: sql<number>`sum(case
                when ${automationLogs.status} in ('failed', 'skipped') then 1
                when ${automationLogs.status} = 'pending' and ${lte(automationLogs.sendAt, overdueBefore)} then 1
                else 0 end)`,
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
