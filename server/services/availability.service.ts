import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { availability, availabilityOverrides } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';

/**
 * Service to manage internal inspector availability schedules.
 *
 * The write side of availability: the recurring weekly grid and the dated
 * exceptions to it. `BookingService` is the read side — it turns these rows,
 * plus busy times and holidays, into bookable slots — and the two never share
 * a query, which is why they no longer share a file.
 */
export class AvailabilityService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Replaces the entire weekly schedule for an inspector.
     */
    async updateWeeklySchedule(tenantId: string, inspectorId: string, slots: { dayOfWeek: number; startTime: string; endTime: string }[]) {
        const db = this.getDrizzle();

        await db.delete(availability).where(and(
            eq(availability.tenantId, tenantId),
            eq(availability.inspectorId, inspectorId)
        ));

        if (slots.length > 0) {
            await db.insert(availability).values(
                slots.map(s => ({
                    id: crypto.randomUUID(),
                    tenantId,
                    inspectorId,
                    dayOfWeek: s.dayOfWeek,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    createdAt: new Date(),
                }))
            );
        }
    }

    /**
     * Adds a specific availability override.
     */
    async addOverride(tenantId: string, data: {
        inspectorId: string;
        date: string;
        isAvailable: boolean;
        startTime?: string | null | undefined;
        endTime?: string | null | undefined;
    }) {
        const db = this.getDrizzle();
        const newOverride = {
            id: crypto.randomUUID(),
            tenantId,
            inspectorId: data.inspectorId,
            date: data.date,
            isAvailable: data.isAvailable,
            startTime: data.startTime || null,
            endTime: data.endTime || null,
            createdAt: new Date(),
        };

        await db.insert(availabilityOverrides).values(newOverride);
        return {
            ...newOverride,
            createdAt: safeISODate(newOverride.createdAt)
        };
    }

    /**
     * Deletes an availability override.
     */
    async deleteOverride(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(availabilityOverrides).where(and(
            eq(availabilityOverrides.id, id),
            eq(availabilityOverrides.tenantId, tenantId)
        )).get();

        if (!existing) throw Errors.NotFound('Override not found');
        await db.delete(availabilityOverrides).where(and(eq(availabilityOverrides.id, id), eq(availabilityOverrides.tenantId, tenantId)));
    }
}
