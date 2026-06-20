import { eq, and, lte, gte, notInArray, ne } from 'drizzle-orm';
import { automations, automationLogs, inspections } from '../../lib/db/schema';
import { nanoid } from 'nanoid';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { type Constructor } from './shared';
import type { AutomationBase, HasParseChannels, HasResolveAddress } from './shared';

/**
 * Reminders mixin: cron-fired enqueue of appointment-reminder logs. Body is
 * byte-identical to the former monolith. Relies on `parseChannels` (core) and
 * `resolveAddress` (trigger), which sit earlier in the mixin chain.
 */
export function AutomationReminders<TBase extends Constructor<AutomationBase & HasParseChannels & HasResolveAddress>>(Base: TBase) {
    return class extends Base {
        /**
         * Track J (D7) — appointment reminders. Cron-fired daily. For each active
         * inspection.reminder rule, scan upcoming inspections within the rule's lead
         * window and enqueue a pending automation_log at (inspection date − lead),
         * floored to now+5min. Deduped on eventId = reminder:<ruleId>:<inspectionId>
         * so re-scans don't double-create. The existing flush() sends it when due and
         * re-checks conditions per D4. Reminders are day-granular (inspections.date is
         * date-only); we anchor the appointment at 09:00 UTC.
         */
        async enqueueReminders(nowMs: number): Promise<number> {
            const db = this.getDrizzle();
            const rules = await db.select().from(automations)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .where(and(eq(automations.trigger, 'inspection.reminder' as any), eq(automations.active, true)));
            if (rules.length === 0) return 0;

            const todayStr = new Date(nowMs).toISOString().slice(0, 10);
            let created = 0;

            for (const rule of rules) {
                // Window upper bound = lead + 1.5d buffer so a same-day cron still
                // catches an appointment whose lead window opens within the next day.
                const upperStr = new Date(nowMs + rule.delayMinutes * 60_000 + 36 * 3600_000)
                    .toISOString().slice(0, 10);
                const upcoming = await db.select().from(inspections)
                    .where(and(
                        eq(inspections.tenantId, rule.tenantId),
                        gte(inspections.date, todayStr),
                        lte(inspections.date, upperStr),
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        notInArray(inspections.status, ['cancelled', 'completed'] as any),
                        ne(inspections.reportStatus, REPORT_STATUS.PUBLISHED),
                    ));

                for (const insp of upcoming) {
                    // Track L — fan out one reminder log per enabled channel. Per-channel
                    // address resolution replaces the old single clientEmail guard.
                    const channels = this.parseChannels(rule.channels);
                    for (const channel of channels) {
                        const addr = await this.resolveAddress(rule.recipient as string, channel, insp, db);
                        if (!addr) continue;
                        // Dedup key is per-channel so email + sms reminders for the same
                        // (rule, inspection) coexist and each de-dupes independently.
                        const eventId = `reminder:${rule.id}:${insp.id}:${channel}`;
                        const dup = await db.select({ id: automationLogs.id }).from(automationLogs)
                            .where(eq(automationLogs.eventId, eventId)).limit(1);
                        if (dup.length > 0) continue;

                        // tz-naive: 09:00 UTC is an approximate anchor (inspections.date is date-only, no tenant tz here).
                        const inspMs = Date.parse(`${insp.date}T09:00:00Z`);
                        if (Number.isNaN(inspMs)) continue;
                        // send_at here is a DISPLAY ESTIMATE only — flush() derives the real
                        // reminder due-time live from the current inspection.date (Task 7),
                        // so a reschedule (a `date` write on the inspection) needs no update
                        // to this row. We still write the estimate: the column is NOT NULL
                        // and it is a useful default for display/sort.
                        let sendAt = inspMs - rule.delayMinutes * 60_000;
                        if (sendAt < nowMs) sendAt = nowMs + 5 * 60_000;

                        await db.insert(automationLogs).values({
                            id: nanoid(), tenantId: rule.tenantId, automationId: rule.id,
                            inspectionId: insp.id, recipient: addr, channel,
                            // send_at is a display estimate; flush() derives the real due-time live from inspection.date
                            sendAt: new Date(sendAt).toISOString(), status: 'pending', eventId,
                        });
                        created++;
                    }
                }
            }
            return created;
        }
    };
}
