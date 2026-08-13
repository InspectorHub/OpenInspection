/**
 * ONE DOOR BACK OUT OF `cancelled` (#81).
 *
 * #78 made `POST /:id/cancel` the only way IN. The way back was left as a plain
 * status write, and the same shape grew there — four writers, none of which
 * agreed. Printed side by side against the code before this spec existed:
 *
 *   PATCH /:id { status }         cleared cancel_reason/notes · audited · re-pushed Google Calendar
 *   POST  /:id/uncancel           cleared cancel_reason/notes · NO audit · NO calendar · NO caller in the product
 *   PATCH /bulk { updateStatus }  cleared NOTHING — a live job still carrying "no_show"
 *   POST  /:id/complete           cleared NOTHING — cancelled straight to completed, no guard at all
 *
 * The dedicated endpoint was the WEAKEST of the four, so it was not adopted as
 * written: the two things the dropdown did moved into it, its role gate was
 * widened to match `POST /:id/cancel` (an inspector who may cancel must be able
 * to undo their own mis-click), and the other three now refuse with
 * USE_UNCANCEL_ENDPOINT.
 *
 * EVERY REFUSAL IS PAIRED WITH A POSITIVE CONTROL, because a gate that refuses
 * everything is indistinguishable from a gate that works — and one of the
 * controls is the whole reason the refusals are narrow: a cancelled inspection
 * is still EDITABLE. Correcting its address must not be refused because of the
 * status it is in.
 *
 * ⚠️ RESTORING IS NOT AN UNDO. The status returns to `scheduled` and the
 * cancellation record is cleared; the kept fee and the issued refund are ledger
 * entries and are deliberately untouched by every path here. Nothing in this
 * file asserts money moving back, because nothing should make it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { makeExecutionContext } from '../helpers/exec-ctx';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// The three observable side effects, spied at the module boundary. Two of them
// are the asymmetry this issue is about: the dedicated endpoint produced
// neither, and adopting it as-is would have quietly dropped both.
const auditSpy = vi.fn();
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: (...args: unknown[]) => auditSpy(...args),
}));

const calendarSpy = vi.fn();
vi.mock('../../../server/lib/calendar/push-hooks', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    pushInspectionAfterResponse: (...args: unknown[]) => calendarSpy(...args),
}));

const automationSpy = vi.fn();
vi.mock('../../../server/services/inspection/shared', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    fireAutomation: (...args: unknown[]) => { automationSpy(...args); return Promise.resolve(); },
}));

import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { InspectionStatusService } from '../../../server/services/inspection/inspection-status.service';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

let db: BetterSQLite3Database<typeof schema>;

/**
 * `currentStatus` is what the handlers' own `getInspection` read reports — the
 * value the recovery guard keys on. Stubbed rather than seeded because the real
 * read joins half the schema.
 *
 * `uncancelInspection` is wired to the REAL service, not a spy: what the
 * endpoint writes to the row is half of what this spec compares.
 */
function buildApp(role: string, currentStatus: string) {
    const app = new OpenAPIHono<HonoConfig>();
    const statusService = new InspectionStatusService({} as D1Database);
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', { inspection: {
            getInspection: vi.fn().mockResolvedValue({ inspection: { status: currentStatus, propertyAddress: '1 Main St' } }),
            isInspectionPhotoKey: vi.fn().mockResolvedValue(false),
            uncancelInspection: (t: string, id: string) => statusService.uncancelInspection(t, id),
        } } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    // Mirrors `server/index.ts`'s AppError branch. Without it a THROWN refusal
    // (the service-layer guard, as opposed to the handlers' returned envelopes)
    // surfaces as a bare 500 here, and this spec would be pinning the harness
    // rather than the contract.
    app.onError((err, c) => {
        const e = err as { status?: number; code?: string; message?: string };
        if (typeof e.status === 'number' && typeof e.code === 'string') {
            return c.json({ success: false, error: { code: e.code, message: e.message } }, e.status as 400);
        }
        throw err;
    });
    return app;
}

/**
 * `/complete` fires an automation through `waitUntil`, so the ctx is real.
 *
 * From the shared helper rather than an inline object literal: `ExecutionContext`
 * gained `props` and `tracing`, neither of which a spec can meaningfully build,
 * so the cast belongs in one place next to the reason for it.
 */
const EXEC_CTX = makeExecutionContext().ctx;

async function call(
    role: string, currentStatus: string, path: string,
    init: RequestInit,
) {
    const res = await buildApp(role, currentStatus).request(path, init, { DB: {} }, EXEC_CTX);
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

const patchOne = (body: unknown, currentStatus: string, role = 'manager') =>
    call(role, currentStatus, `/api/inspections/${INSP_ID}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const patchBulk = (body: unknown, currentStatus = 'requested') =>
    call('owner', currentStatus, '/api/inspections/bulk',
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const postUncancel = (currentStatus: string, role = 'manager') =>
    call(role, currentStatus, `/api/inspections/${INSP_ID}/uncancel`, { method: 'POST' });

const postComplete = (currentStatus: string) =>
    call('manager', currentStatus, `/api/inspections/${INSP_ID}/complete`, { method: 'POST' });

async function row() {
    return await db.select().from(schema.inspections)
        .where(eq(schema.inspections.id, INSP_ID)).get() as unknown as {
            status: string; cancelReason: string | null; cancelNotes: string | null; county: string | null;
        };
}

/** Put the row in the state a mis-click leaves behind, and reset the spies. */
async function seedCancelled() {
    await db.update(schema.inspections)
        .set({ status: 'cancelled', cancelReason: 'no_show', cancelNotes: 'nobody home' })
        .where(eq(schema.inspections.id, INSP_ID));
    auditSpy.mockClear(); calendarSpy.mockClear(); automationSpy.mockClear();
}

/** The refusal every closed door must produce, named once. */
function expectUncancelRefusal(result: { status: number; body: Record<string, unknown> }) {
    expect(result.status).toBe(400);
    const error = result.body.error as { code?: string; message?: string } | undefined;
    expect(error?.code).toBe('USE_UNCANCEL_ENDPOINT');
    // The message has to name the endpoint AND the thing that does not happen
    // there. A refusal that only says "no" sends the next caller looking for
    // another status string to try, and one that promises an undo is worse.
    expect(error?.message).toContain('/uncancel');
    expect(error?.message).toMatch(/does not reverse/i);
}

describe('#81 — leaving `cancelled` goes through POST /api/inspections/:id/uncancel', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 's', status: 'active',
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

    // ── The one door ────────────────────────────────────────────────────────
    describe('POST /:id/uncancel', () => {
        it('returns the inspection to scheduled and clears the cancellation record', async () => {
            await seedCancelled();
            expect((await postUncancel('cancelled')).status).toBe(200);

            const after = await row();
            expect(after.status).toBe('scheduled');
            // A live inspection carrying "no_show" is a lie that outlives the mistake.
            expect(after.cancelReason).toBeNull();
            expect(after.cancelNotes).toBeNull();
        });

        it('writes the audit row the dropdown used to write', async () => {
            await seedCancelled();
            await postUncancel('cancelled');

            expect(auditSpy).toHaveBeenCalledTimes(1);
            expect(auditSpy.mock.calls[0]?.[1]).toBe('inspection.status_change');
            expect(auditSpy.mock.calls[0]?.[3]).toMatchObject({
                metadata: { from: 'cancelled', to: 'scheduled' },
            });
        });

        it('restores the Google Calendar entry the cancel took off', async () => {
            await seedCancelled();
            await postUncancel('cancelled');
            expect(calendarSpy).toHaveBeenCalledTimes(1);
        });

        it('fires no automation — there is no "uncancelled" notice to send', async () => {
            // Re-sending "your inspection is booked" off a correction is not
            // what any seeded rule means, and no such trigger exists.
            await seedCancelled();
            await postUncancel('cancelled');
            expect(automationSpy).not.toHaveBeenCalled();
        });

        it('lets an inspector undo their own mis-click, like POST /:id/cancel does', async () => {
            await seedCancelled();
            expect((await postUncancel('cancelled', 'inspector')).status).toBe(200);
            expect((await row()).status).toBe('scheduled');
        });

        it('POSITIVE CONTROL — refuses an inspection that is not cancelled', async () => {
            // The guard is the one thing this endpoint always had that the
            // dropdown never did; consolidating must not lose it.
            await db.update(schema.inspections).set({ status: 'scheduled' })
                .where(eq(schema.inspections.id, INSP_ID));
            const res = await postUncancel('scheduled');
            expect(res.status).toBe(400);
            expect((res.body.error as { message?: string }).message).toMatch(/not cancelled/i);
            expect((await row()).status).toBe('scheduled');
        });
    });

    // ── PATCH /api/inspections/:id ──────────────────────────────────────────
    describe('the row dropdown no longer reaches the plain status PATCH', () => {
        it('refuses cancelled → scheduled and leaves the row exactly as it was', async () => {
            await seedCancelled();
            expectUncancelRefusal(await patchOne({ status: 'scheduled' }, 'cancelled'));

            const after = await row();
            expect(after.status).toBe('cancelled');
            expect(after.cancelReason).toBe('no_show');
            expect(calendarSpy).not.toHaveBeenCalled();
            expect(auditSpy).not.toHaveBeenCalled();
        });

        it('refuses every other target status too, not just scheduled', async () => {
            for (const status of ['requested', 'confirmed', 'completed']) {
                await seedCancelled();
                expectUncancelRefusal(await patchOne({ status }, 'cancelled'));
                expect((await row()).status).toBe('cancelled');
            }
        });

        it('refuses the whole patch, not just the status field', async () => {
            await seedCancelled();
            expectUncancelRefusal(await patchOne({ status: 'scheduled', county: 'Marion' }, 'cancelled'));
            expect((await row()).county).toBeNull();
        });

        it('POSITIVE CONTROL — a cancelled inspection is still editable', async () => {
            // The narrowest thing this guard must not break. A cancellation is
            // a record people keep working on: the address is corrected, the
            // note explaining it is added. Refusing that would trade one
            // silent failure for a louder one.
            await seedCancelled();
            expect((await patchOne({ county: 'Marion' }, 'cancelled')).status).toBe(200);
            const after = await row();
            expect(after.county).toBe('Marion');
            expect(after.status).toBe('cancelled');
            expect(after.cancelReason).toBe('no_show');
        });

        it('POSITIVE CONTROL — status changes on a live inspection still work', async () => {
            expect((await patchOne({ status: 'completed' }, 'requested')).status).toBe(200);
            expect((await row()).status).toBe('completed');
        });
    });

    // ── PATCH /api/inspections/bulk — the third path ────────────────────────
    describe('the bulk door', () => {
        it('refuses a batch containing a cancelled inspection', async () => {
            await seedCancelled();
            expectUncancelRefusal(await patchBulk({
                ids: [INSP_ID], action: 'updateStatus', status: 'scheduled',
            }, 'cancelled'));
        });

        it('leaves the cancellation record intact when refused', async () => {
            // This is what the bulk door got WRONG rather than merely skipped:
            // it moved the row and left `cancel_reason` on it, which the single
            // PATCH went out of its way to prevent.
            await seedCancelled();
            await patchBulk({ ids: [INSP_ID], action: 'updateStatus', status: 'scheduled' }, 'cancelled');
            const after = await row();
            expect(after.status).toBe('cancelled');
            expect(after.cancelReason).toBe('no_show');
            expect(after.cancelNotes).toBe('nobody home');
        });

        it('POSITIVE CONTROL — a batch of live inspections still updates', async () => {
            const res = await patchBulk({ ids: [INSP_ID], action: 'updateStatus', status: 'confirmed' });
            expect(res.status).toBe(200);
            expect((await row()).status).toBe('confirmed');
        });
    });

    // ── POST /api/inspections/:id/complete — the fourth path ────────────────
    describe('the complete door', () => {
        it('refuses to complete a cancelled inspection', async () => {
            // `confirmInspection` has always refused one. This route makes the
            // same claim about the same axis — the visit happened — and had no
            // guard, so it walked a cancelled job to `completed` with
            // `cancel_reason` still attached.
            await seedCancelled();
            expectUncancelRefusal(await postComplete('cancelled'));

            const after = await row();
            expect(after.status).toBe('cancelled');
            expect(after.cancelReason).toBe('no_show');
        });

        it('POSITIVE CONTROL — a live inspection still completes', async () => {
            expect((await postComplete('scheduled')).status).toBe(200);
            expect((await row()).status).toBe('completed');
        });
    });
});
