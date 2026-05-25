/**
 * Design System 0520 subsystem C phase 2 — ApprenticeService.
 *
 * Apprentice writes (rating / notes / value) route into this queue
 * instead of inspection_results.data directly. The mentor reviews +
 * approves / rejects / edits each entry from /apprentice-review
 * (Phase 3 page); on approve / edit the value lands in the canonical
 * inspection state via InspectionService.patchItem(force: true).
 *
 * Tenant isolation via explicit tenantId on every public method.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { apprenticeReviews, users } from '../lib/db/schema';

export type ApprenticeField = 'rating' | 'notes' | 'value';
export type ApprenticeStatus = 'pending' | 'approved' | 'rejected' | 'edited';

export interface QueuedResult {
    kind:     'queued';
    reviewId: string;
}

export type DecideResult =
    | { kind: 'ok' }
    | { kind: 'not_found' };

export class ApprenticeService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async submitForReview(
        tenantId:     string,
        apprenticeId: string,
        inspectionId: string,
        itemId:       string,
        field:        ApprenticeField,
        value:        unknown,
    ): Promise<QueuedResult> {
        const db = this.getDrizzle();

        // Resolve mentor from the apprentice's user row. Apprentices without
        // a mentor cannot submit — the route surface translates this into a
        // 400 "Apprentice has no mentor" instead of writing a junk row.
        const apprentice = await db.select().from(users)
            .where(and(eq(users.id, apprenticeId), eq(users.tenantId, tenantId)))
            .get();
        if (!apprentice?.mentorId) {
            throw new Error('Apprentice has no mentor assigned');
        }

        const id = crypto.randomUUID();
        await db.insert(apprenticeReviews).values({
            id,
            tenantId,
            apprenticeId,
            mentorId:      apprentice.mentorId,
            inspectionId,
            itemId,
            field,
            proposedValue: JSON.stringify(value),
            status:        'pending',
            submittedAt:   Math.floor(Date.now() / 1000),
            createdAt:     new Date().toISOString(),
        });

        return { kind: 'queued', reviewId: id };
    }

    async getById(tenantId: string, reviewId: string) {
        const db = this.getDrizzle();
        return await db.select().from(apprenticeReviews)
            .where(and(eq(apprenticeReviews.id, reviewId), eq(apprenticeReviews.tenantId, tenantId)))
            .get() ?? null;
    }

    async listPendingForMentor(tenantId: string, mentorId: string) {
        const db = this.getDrizzle();
        return await db.select().from(apprenticeReviews)
            .where(and(
                eq(apprenticeReviews.tenantId, tenantId),
                eq(apprenticeReviews.mentorId, mentorId),
                eq(apprenticeReviews.status, 'pending'),
            ))
            .all();
    }

    async decide(
        tenantId:      string,
        reviewId:      string,
        action:        Exclude<ApprenticeStatus, 'pending'>,
        decisionValue?: unknown,
    ): Promise<DecideResult> {
        const db = this.getDrizzle();
        const scope = and(eq(apprenticeReviews.id, reviewId), eq(apprenticeReviews.tenantId, tenantId));

        const row = await db.select().from(apprenticeReviews).where(scope).get();
        if (!row) return { kind: 'not_found' };

        await db.update(apprenticeReviews).set({
            status:        action,
            decisionAt:    Math.floor(Date.now() / 1000),
            decisionValue: action === 'edited' && decisionValue !== undefined
                ? JSON.stringify(decisionValue)
                : null,
        }).where(scope);
        return { kind: 'ok' };
    }
}
