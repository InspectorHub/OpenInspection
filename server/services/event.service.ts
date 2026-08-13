import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { eventTypes, inspectionEvents, automations, automationLogs } from '../lib/db/schema';
import { EVENT_TYPES } from './starter-content/fixtures/event-types';
import { logger } from '../lib/logger';
import { PeopleService } from './people.service';
import { resolveAutomationCompanyName } from './automation/company-name';
import { EVENT_STATUS, type EventStatus } from '../lib/status/event-status';

const REMINDER_MIN_DELAY_MS = 5 * 60_000;
const REMINDER_LEAD_MS      = 24 * 3600_000;
/**
 * Used only when an event's type cannot be resolved at all. The real value is
 * `event_types.follow_up_delay_hours`, whose column default is this same 72 —
 * so a tenant who has never touched the setting sees exactly the behaviour this
 * constant used to impose on everyone.
 */
const DEFAULT_FOLLOWUP_DELAY_HOURS = 72;

export class EventService {
    constructor(private db: D1Database) {}

    // ---- Event types ----

    async listEventTypes(tenantId: string) {
        return drizzle(this.db).select().from(eventTypes)
            .where(eq(eventTypes.tenantId, tenantId))
            .orderBy(asc(eventTypes.sortOrder)).all();
    }

    async createEventType(tenantId: string, data: Record<string, unknown>) {
        const row = {
            id:        crypto.randomUUID(),
            tenantId,
            createdAt: new Date(),
            active:    true,
            ...data,
        } as typeof eventTypes.$inferInsert;
        await drizzle(this.db).insert(eventTypes).values(row).run();
        return row;
    }

    async updateEventType(tenantId: string, id: string, data: Record<string, unknown>) {
        await drizzle(this.db).update(eventTypes).set(data as never)
            .where(and(eq(eventTypes.id, id), eq(eventTypes.tenantId, tenantId))).run();
    }

    async deactivateEventType(tenantId: string, id: string): Promise<void> {
        const d = drizzle(this.db);
        const usage = await d.select({ id: inspectionEvents.id }).from(inspectionEvents)
            .where(and(eq(inspectionEvents.eventTypeId, id), eq(inspectionEvents.tenantId, tenantId)))
            .limit(1).all();
        if (usage.length === 0) {
            await d.delete(eventTypes)
                .where(and(eq(eventTypes.id, id), eq(eventTypes.tenantId, tenantId))).run();
        } else {
            await d.update(eventTypes).set({ active: false })
                .where(and(eq(eventTypes.id, id), eq(eventTypes.tenantId, tenantId))).run();
        }
    }

    async bulkSeed(tenantId: string): Promise<{ seeded: number; skipped: number }> {
        const d = drizzle(this.db);
        const existing = await d.select({ slug: eventTypes.slug }).from(eventTypes)
            .where(eq(eventTypes.tenantId, tenantId)).all();
        const existingSlugs = new Set(existing.map(e => e.slug as string));
        let seeded = 0, skipped = 0;
        // Same list provisioning uses. This endpoint is now a repair tool —
        // idempotent on slug, so it fills gaps for a tenant provisioned before a
        // type existed and does nothing for anyone else.
        for (const seed of EVENT_TYPES) {
            if (existingSlugs.has(seed.slug)) { skipped++; continue; }
            await d.insert(eventTypes).values({
                id:        crypto.randomUUID(),
                tenantId,
                createdAt: new Date(),
                active:    true,
                ...seed,
            }).run();
            seeded++;
        }
        return { seeded, skipped };
    }

    // ---- Inspection events ----

    async listInspectionEvents(tenantId: string, inspectionId: string) {
        return drizzle(this.db).select().from(inspectionEvents)
            .where(and(eq(inspectionEvents.tenantId, tenantId), eq(inspectionEvents.inspectionId, inspectionId)))
            .orderBy(asc(inspectionEvents.scheduledAt)).all();
    }

    async listEventsByDateRange(tenantId: string, fromTs: number, toTs: number) {
        return drizzle(this.db).select().from(inspectionEvents)
            .where(and(
                eq(inspectionEvents.tenantId, tenantId),
                gte(inspectionEvents.scheduledAt, new Date(fromTs)),
                lte(inspectionEvents.scheduledAt, new Date(toTs)),
            )).orderBy(asc(inspectionEvents.scheduledAt)).all();
    }

    /**
     * Returns the timestamp at which the 24h-before-event reminder should be sent.
     * If event is scheduled less than 24h from now, return now+5min so reminder still fires
     * (rather than skip or backdate).
     */
    computeReminderSendAt(scheduledAtMs: number): number {
        const reminderTs = scheduledAtMs - REMINDER_LEAD_MS;
        if (reminderTs < Date.now()) return Date.now() + REMINDER_MIN_DELAY_MS;
        return reminderTs;
    }

    async createEvent(tenantId: string, inspectionId: string, data: Record<string, unknown>) {
        const d = drizzle(this.db);
        const row = {
            id:        crypto.randomUUID(),
            tenantId,
            inspectionId,
            createdAt: new Date(),
            status:    EVENT_STATUS.SCHEDULED,
            ...data,
        } as typeof inspectionEvents.$inferInsert;
        await d.insert(inspectionEvents).values(row).run();
        await this.scheduleReminderLog(tenantId, row.id, inspectionId, new Date(row.scheduledAt!).getTime());
        return row;
    }

    async updateEventStatus(tenantId: string, id: string, status: EventStatus) {
        const d = drizzle(this.db);
        const patch: Record<string, unknown> = { status };
        if (status === EVENT_STATUS.COMPLETED)        patch.completedAt       = new Date();
        if (status === EVENT_STATUS.RESULTS_RECEIVED) patch.resultsReceivedAt = new Date();
        if (status === EVENT_STATUS.CANCELLED)        patch.cancelledAt       = new Date();
        await d.update(inspectionEvents).set(patch as never)
            .where(and(eq(inspectionEvents.id, id), eq(inspectionEvents.tenantId, tenantId))).run();
        if (status === EVENT_STATUS.COMPLETED || status === EVENT_STATUS.RESULTS_RECEIVED) {
            const ev = await d.select().from(inspectionEvents)
                .where(and(eq(inspectionEvents.id, id), eq(inspectionEvents.tenantId, tenantId))).get();
            if (ev && status === EVENT_STATUS.COMPLETED) {
                await this.scheduleFollowupLog(
                    tenantId, id, ev.inspectionId as string, ev.eventTypeId as string, Date.now(),
                );
            } else if (ev) {
                await this.fireResultsReceived(tenantId, id, ev.inspectionId as string);
            }
        }
    }

    /**
     * The lab result arriving is a domain event with recipients, not just a
     * timestamp. It goes through the ordinary automation fan-out instead of the
     * hand-rolled pre-insert its two neighbours use: those exist only because
     * their send time is COMPUTED (24h before the visit, N hours after it), and
     * the price they pay is addressing exactly one recipient on exactly one
     * channel. Results are "now", so every rule on the trigger, every channel it
     * enables and every recipient it resolves apply — which is what makes the
     * buyer's-agent and SMS seeds real rather than decorative.
     *
     * Never throws: a notification failure must not roll back the transition the
     * office just recorded. `results_received_at` is already written above.
     */
    private async fireResultsReceived(tenantId: string, eventId: string, inspectionId: string): Promise<void> {
        try {
            const { AutomationService } = await import('./automation.service');
            await new AutomationService(this.db).trigger({
                tenantId, inspectionId,
                triggerEvent: 'event.results_received',
                companyName: await resolveAutomationCompanyName(drizzle(this.db), tenantId), reportBaseUrl: '',
                // Carries the visit through to delivery: the copy names the
                // event type from it, and a retry dedupes on it.
                eventId,
            });
        } catch (err) {
            logger.error('automation trigger failed', { event: 'event.results_received', eventId },
                err instanceof Error ? err : undefined);
        }
    }

    async deleteEvent(tenantId: string, id: string) {
        await drizzle(this.db).delete(inspectionEvents)
            .where(and(eq(inspectionEvents.id, id), eq(inspectionEvents.tenantId, tenantId))).run();
    }

    private async scheduleReminderLog(tenantId: string, eventId: string, inspectionId: string, scheduledAtMs: number) {
        const d = drizzle(this.db);
        const rule = await d.select().from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.trigger, 'event.created' as never))).get();
        if (!rule || !rule.active) return;
        // Task 9b (people-role-profiles) — resolve the recipient via the
        // inspection_people primary-client join instead of the legacy
        // inspection.clientEmail column (dropped, Task 13).
        const client = await new PeopleService({ DB: this.db }).getPrimaryClient(tenantId, inspectionId);
        if (!client?.email) return;
        const sendAt = this.computeReminderSendAt(scheduledAtMs);
        await d.insert(automationLogs).values({
            id:             crypto.randomUUID(),
            tenantId,
            automationId:   rule.id as string,
            inspectionId,
            recipient:      client.email,
            sendAt:         new Date(sendAt),
            status:         'pending',
            eventId,
        }).run();
        logger.info('Event reminder log queued', { tenantId, eventId, sendAt });
    }

    /**
     * When a completed visit's follow-up should be sent.
     *
     * Per event type, because 72 hours is a radon answer: a sewer scope's
     * results exist the moment the camera comes out, and a follow-up three days
     * later is telling the client something they already knew. Zero is
     * therefore a real setting and is read with `??` — `||` would silently
     * restore the 72-hour default for exactly the case the column exists for.
     *
     * A missing event type falls back to the same 72 hours the column defaults
     * to, so an orphaned event behaves as it did before this was configurable.
     */
    async followUpSendAt(tenantId: string, eventTypeId: string | null, completedAtMs: number): Promise<number> {
        let hours = DEFAULT_FOLLOWUP_DELAY_HOURS;
        if (eventTypeId) {
            const row = await drizzle(this.db)
                .select({ followUpDelayHours: eventTypes.followUpDelayHours }).from(eventTypes)
                .where(and(eq(eventTypes.id, eventTypeId), eq(eventTypes.tenantId, tenantId))).get();
            hours = row?.followUpDelayHours ?? DEFAULT_FOLLOWUP_DELAY_HOURS;
        }
        return completedAtMs + hours * 3600_000;
    }

    private async scheduleFollowupLog(
        tenantId: string, eventId: string, inspectionId: string,
        eventTypeId: string | null, completedAtMs: number,
    ) {
        const d = drizzle(this.db);
        const rule = await d.select().from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.trigger, 'event.completed' as never))).get();
        if (!rule || !rule.active) return;
        // Task 9b (people-role-profiles) — resolve the recipient via the
        // inspection_people primary-client join instead of the legacy
        // inspection.clientEmail column (dropped, Task 13).
        const client = await new PeopleService({ DB: this.db }).getPrimaryClient(tenantId, inspectionId);
        if (!client?.email) return;
        const sendAt = await this.followUpSendAt(tenantId, eventTypeId, completedAtMs);
        await d.insert(automationLogs).values({
            id:             crypto.randomUUID(),
            tenantId,
            automationId:   rule.id as string,
            inspectionId,
            recipient:      client.email,
            sendAt:         new Date(sendAt),
            status:         'pending',
            eventId,
        }).run();
        logger.info('Event followup log queued', { tenantId, eventId, sendAt });
    }
}
