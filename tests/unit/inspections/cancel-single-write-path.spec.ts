/**
 * ONE DOOR TO `status = 'cancelled'` (#78).
 *
 * The fee ladder, the refund and the policy snapshot all happen inside
 * `POST /api/inspections/:id/cancel` and nowhere else. Every OTHER way to write
 * the string 'cancelled' onto an inspection therefore cancels the job while
 * leaving the money untouched — the invoice still reads as owed, the deposit
 * stays held, no `cancel_reason` is recorded and `inspection.cancelled` never
 * fires. Two of those doors existed:
 *
 *   1. `PATCH /api/inspections/:id`      { status: 'cancelled' }
 *   2. `PATCH /api/inspections/bulk`     { action: 'updateStatus', status: 'cancelled' }
 *
 * Both now refuse and name the endpoint that does it properly. The refusals are
 * paired with positive controls, because a gate that refuses everything is
 * indistinguishable from a gate that works.
 *
 * THE RECOVERY CASE IS PART OF THE CONTRACT. A mistakenly-cancelled inspection
 * is moved back through the same PATCH — 'cancelled' → 'scheduled' — and that
 * direction must keep working, or a mis-click in the confirmation dialog would
 * be permanent. Coming back also clears `cancel_reason` / `cancel_notes`: they
 * describe a cancellation that no longer stands, and leaving them behind is how
 * a live inspection ends up carrying "no_show" in its record.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

let db: BetterSQLite3Database<typeof schema>;

/**
 * `currentStatus` is what the handler's own `getInspection` read reports. It is
 * stubbed rather than seeded because the real read joins half the schema, and
 * the only field this route consults is the status it is transitioning FROM.
 */
function buildApp(role: string, currentStatus: string) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', { inspection: {
            getInspection: vi.fn().mockResolvedValue({ inspection: { status: currentStatus } }),
            isInspectionPhotoKey: vi.fn().mockResolvedValue(false),
        } } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

async function request(role: string, currentStatus: string, path: string, body: unknown) {
    const res = await buildApp(role, currentStatus).request(
        path,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        { DB: {} },
    );
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

const patchOne = (body: unknown, currentStatus = 'requested') =>
    request('manager', currentStatus, `/api/inspections/${INSP_ID}`, body);

const patchBulk = (body: unknown) =>
    request('owner', 'requested', '/api/inspections/bulk', body);

async function row() {
    return await db.select().from(schema.inspections)
        .where(eq(schema.inspections.id, INSP_ID)).get() as unknown as {
            status: string; cancelReason: string | null; cancelNotes: string | null;
        };
}

/** The refusal both doors must produce, named once. */
function expectCancelRefusal(result: { status: number; body: Record<string, unknown> }) {
    expect(result.status).toBe(400);
    const error = result.body.error as { code?: string; message?: string } | undefined;
    expect(error?.code).toBe('USE_CANCEL_ENDPOINT');
    // The message has to say where to go instead. A refusal that only says "no"
    // sends the next caller looking for a different status string to try.
    expect(error?.message).toContain('/cancel');
}

describe('#78 — `cancelled` may only be written by POST /api/inspections/:id/cancel', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 's', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    // ── PATCH /api/inspections/:id ──────────────────────────────────────────
    it('refuses PATCH { status: "cancelled" } and leaves the row alone', async () => {
        expectCancelRefusal(await patchOne({ status: 'cancelled' }));
        expect((await row()).status).toBe('requested');
    });

    it('refuses the whole patch, not just the status field', async () => {
        // A partial application would be worse than either outcome: the county
        // saved, the cancellation silently dropped, and nothing said so.
        expectCancelRefusal(await patchOne({ status: 'cancelled', county: 'Marion' }));
        const after = await row() as unknown as { county: string | null };
        expect(after.county).toBeNull();
    });

    it('POSITIVE CONTROL — a legitimate status transition still succeeds', async () => {
        expect((await patchOne({ status: 'completed' })).status).toBe(200);
        expect((await row()).status).toBe('completed');
    });

    // ── Recovery from a mis-click ───────────────────────────────────────────
    it('un-cancels: cancelled → scheduled succeeds and clears the cancellation record', async () => {
        await db.update(schema.inspections)
            .set({ status: 'cancelled', cancelReason: 'no_show', cancelNotes: 'nobody home' })
            .where(eq(schema.inspections.id, INSP_ID));

        expect((await patchOne({ status: 'scheduled' }, 'cancelled')).status).toBe(200);

        const after = await row();
        expect(after.status).toBe('scheduled');
        expect(after.cancelReason).toBeNull();
        expect(after.cancelNotes).toBeNull();
    });

    it('does not clear the cancellation record on a patch that leaves the status alone', async () => {
        await db.update(schema.inspections)
            .set({ status: 'cancelled', cancelReason: 'no_show' })
            .where(eq(schema.inspections.id, INSP_ID));

        expect((await patchOne({ county: 'Marion' }, 'cancelled')).status).toBe(200);
        expect((await row()).cancelReason).toBe('no_show');
    });

    // ── PATCH /api/inspections/bulk ─────────────────────────────────────────
    it('refuses the bulk updateStatus door too', async () => {
        expectCancelRefusal(await patchBulk({
            ids: [INSP_ID], action: 'updateStatus', status: 'cancelled',
        }));
        expect((await row()).status).toBe('requested');
    });

    it('POSITIVE CONTROL — bulk updateStatus to a non-terminal status still succeeds', async () => {
        const res = await patchBulk({ ids: [INSP_ID], action: 'updateStatus', status: 'confirmed' });
        expect(res.status).toBe(200);
        expect((await row()).status).toBe('confirmed');
    });
});
