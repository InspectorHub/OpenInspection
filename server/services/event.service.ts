import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { eventTypes, inspectionEvents, inspections, automations, automationLogs } from '../lib/db/schema';
import { EVENT_TYPE_SEEDS } from '../data/event-type-seeds';
import { logger } from '../lib/logger';

const REMINDER_MIN_DELAY_MS = 5 * 60_000;
const REMINDER_LEAD_MS      = 24 * 3600_000;
const FOLLOWUP_DELAY_MS     = 72 * 3600_000;

export type EventStatus = 'scheduled' | 'completed' | 'results_received' | 'cancelled';

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
        for (const seed of EVENT_TYPE_SEEDS) {
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
            status:    'scheduled' as const,
            ...data,
        } as typeof inspectionEvents.$inferInsert;
        await d.insert(inspectionEvents).values(row).run();
        await this.scheduleReminderLog(tenantId, row.id, inspectionId, new Date(row.scheduledAt!).getTime());
        return row;
    }

    async updateEventStatus(tenantId: string, id: string, status: EventStatus) {
        const d = drizzle(this.db);
        const patch: Record<string, unknown> = { status };
        if (status === 'completed')        patch.completedAt       = new Date();
        if (status === 'results_received') patch.resultsReceivedAt = new Date();
        if (status === 'cancelled')        patch.cancelledAt       = new Date();
        await d.update(inspectionEvents).set(patch as never)
            .where(and(eq(inspectionEvents.id, id), eq(inspectionEvents.tenantId, tenantId))).run();
        if (status === 'completed') {
            const ev = await d.select().from(inspectionEvents).where(eq(inspectionEvents.id, id)).get();
            if (ev) await this.scheduleFollowupLog(tenantId, id, ev.inspectionId as string, Date.now());
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
        const insp = await d.select().from(inspections).where(eq(inspections.id, inspectionId)).get();
        if (!insp?.clientEmail) return;
        const sendAt = this.computeReminderSendAt(scheduledAtMs);
        await d.insert(automationLogs).values({
            id:             crypto.randomUUID(),
            tenantId,
            automationId:   rule.id as string,
            inspectionId,
            recipient:      insp.clientEmail as string,
            sendAt:         new Date(sendAt).toISOString(),
            status:         'pending',
            eventId,
        }).run();
        logger.info('Event reminder log queued', { tenantId, eventId, sendAt });
    }

    private async scheduleFollowupLog(tenantId: string, eventId: string, inspectionId: string, completedAtMs: number) {
        const d = drizzle(this.db);
        const rule = await d.select().from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.trigger, 'event.completed' as never))).get();
        if (!rule || !rule.active) return;
        const insp = await d.select().from(inspections).where(eq(inspections.id, inspectionId)).get();
        if (!insp?.clientEmail) return;
        const sendAt = completedAtMs + FOLLOWUP_DELAY_MS;
        await d.insert(automationLogs).values({
            id:             crypto.randomUUID(),
            tenantId,
            automationId:   rule.id as string,
            inspectionId,
            recipient:      insp.clientEmail as string,
            sendAt:         new Date(sendAt).toISOString(),
            status:         'pending',
            eventId,
        }).run();
        logger.info('Event followup log queued', { tenantId, eventId, sendAt });
    }
}
