import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte } from 'drizzle-orm';
import { availability, availabilityOverrides, inspections, users } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';

/**
 * Service to handle public booking flow and availability lookups.
 */
export class BookingService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists all active inspectors for a tenant.
     */
    async listInspectors(tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select({ id: users.id, email: users.email })
            .from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.role, 'inspector')))
            .all();
            
        return rows.map(r => ({
            id: r.id,
            name: r.email.split('@')[0] // Use email prefix as name since name field is missing
        }));
    }

    /**
     * Fetches the availability profile for an inspector.
     */
    async getAvailability(tenantId: string, inspectorId: string, startDate: string, endDate: string) {
        const db = this.getDrizzle();
        
        const [recurring, overrides, jobs] = await Promise.all([
            db.select().from(availability).where(eq(availability.inspectorId, inspectorId)).all(),
            db.select().from(availabilityOverrides).where(and(
                eq(availabilityOverrides.inspectorId, inspectorId),
                gte(availabilityOverrides.date, startDate),
                lte(availabilityOverrides.date, endDate)
            )).all(),
            db.select({ date: inspections.date }).from(inspections).where(and(
                eq(inspections.tenantId, tenantId),
                eq(inspections.inspectorId, inspectorId),
                gte(inspections.date, startDate),
                lte(inspections.date, endDate)
            )).all()
        ]);

        return { 
            baseAvailability: recurring, 
            overrides, 
            bookedSlots: jobs.map(j => j.date) 
        };
    }

    /**
     * Internal helper to verify bot protection (Turnstile).
     */
    async verifyBotProtection(token: string, secret: string) {
        try {
            const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret, response: token }),
            });
            const data = await res.json() as { success: boolean };
            return data.success;
        } catch (e) {
            console.error('[bot-protection] Turnstile verification failed:', e);
            return false;
        }
    }
}

/**
 * Service to manage internal inspector availability schedules.
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
        await db.delete(availabilityOverrides).where(eq(availabilityOverrides.id, id));
    }
}
