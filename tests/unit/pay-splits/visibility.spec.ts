/**
 * Pay-split visibility, asserted over HTTP (#278).
 *
 * These go through `app.request` rather than calling the service, because the
 * thing being pinned is not a function's return value — it is what a REQUEST
 * receives. The rule ("an inspector sees their own pay and nobody else's") is a
 * third state that no boolean permission can express: `financial: false` AND
 * `subject = self`. It is implemented as QUERY SCOPING inside the handler, so a
 * test that bypassed the route would prove nothing at all.
 *
 * The load-bearing assertion is the negative one: a colleague's amount must be
 * ABSENT from the payload, not merely unrendered. A wage hidden in the response
 * body is a wage that has been disclosed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import {
    tenants, users, services, inspections, inspectionServices, servicePayRules,
    inspectionServicePaySplits,
} from '../../../server/lib/db/schema';
import { syncInspectionAssignments } from '../../../server/lib/db/assignment-links';
import { populateSplits } from '../../../server/services/pay-split.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';
// eslint-disable-next-line import/order
import teamRoutes from '../../../server/api/team';

const T = 't1';
const INSP = 'i1';
const LINE = 'line1';
const SVC = 'svc-home';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

let db: DrizzleD1Database;

type Overrides = Record<string, boolean> | null;

function buildApp(actor: string, role: UserRole, overrides: Overrides = null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: actor, role, tenantId: T });
        c.set('sdb', {
            getById: async () => ({ permissionOverrides: overrides }),
        } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.route('/api/team', teamRoutes);
    return app;
}

const getSplitsAs = (actor: string, role: UserRole, overrides: Overrides = null) =>
    buildApp(actor, role, overrides).request(`/api/inspections/${INSP}/pay-splits`, {}, FAKE_ENV);

// 20000c against a 50000c line whose other inspector already holds 15000c —
// inside the "splits sum to <= the line price" guard, so a 400 here would mean
// that guard fired rather than that the caller was refused.
const patchSplitAs = (actor: string, role: UserRole, splitId: string, overrides: Overrides = null) =>
    buildApp(actor, role, overrides).request(`/api/inspections/${INSP}/pay-splits/${splitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: 20000 }),
    }, FAKE_ENV);

const exportPayrollAs = (actor: string, role: UserRole, overrides: Overrides = null) =>
    buildApp(actor, role, overrides).request('/api/team/payroll-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromMs: 0, toMs: Date.now() + 86_400_000 }),
    }, FAKE_ENV);

const splitIdFor = async (userId: string) => {
    const row = await db.select().from(inspectionServicePaySplits)
        .where(and(eq(inspectionServicePaySplits.tenantId, T), eq(inspectionServicePaySplits.userId, userId)))
        .limit(1).get();
    if (!row) throw new Error(`no split seeded for ${userId}`);
    return row.id;
};

beforeEach(async () => {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    db = drizzle(fixture.sqlite, { schema }) as unknown as DrizzleD1Database;
    const now = new Date();

    await db.insert(tenants).values({
        id: T, slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: now,
    }).run();
    for (const id of ['u1', 'u2']) {
        await db.insert(users).values({
            id, tenantId: T, email: `${id}@acme.test`, passwordHash: 'x',
            name: id.toUpperCase(), role: 'inspector', createdAt: now,
        }).run();
    }
    await db.insert(services).values({
        id: SVC, tenantId: T, name: 'Home Inspection', price: 50000, createdAt: now,
    }).run();
    await db.insert(inspections).values({
        id: INSP, tenantId: T, propertyAddress: '1 Oak St', date: '2026-08-01', createdAt: now,
    }).run();
    await db.insert(inspectionServices).values({
        id: LINE, tenantId: T, inspectionId: INSP, serviceId: SVC,
        nameSnapshot: 'Home Inspection', priceSnapshot: 50000,
    }).run();
    await db.insert(servicePayRules).values({
        id: 'rule-default', tenantId: T, serviceId: SVC, userId: null,
        type: 'percent', value: 6000, deductionCents: null, createdAt: now,
    }).run();
    // Full-replace roster write, the same call every production path makes.
    await syncInspectionAssignments(db, T, INSP, { leadInspectorId: 'u1', helperInspectorIds: ['u2'] });
    await populateSplits(db, T, INSP);
});

describe('GET /api/inspections/:id/pay-splits — who sees whose pay', () => {
    it('an inspector sees only their own split', async () => {
        const res = await getSplitsAs('u1', 'inspector');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { splits: { userId: string }[]; scope: string; canEdit: boolean } };
        expect(body.data.splits.length).toBeGreaterThan(0);
        expect(body.data.splits.every(s => s.userId === 'u1')).toBe(true);
        expect(body.data.scope).toBe('self');
        expect(body.data.canEdit).toBe(false);
    });

    it("an inspector never receives a colleague's amount, not even to hide it", async () => {
        // A wage is not information to withhold visually — it must not be in
        // the payload at all. This is the assertion the whole design serves.
        //
        // Checked over VALUES, not over the serialized blob. The blob form
        // (`JSON.stringify(body)).not.toContain('u2')`) read as a strict
        // superset and was in fact a coin flip: split ids are `nanoid()`, 21
        // random characters from a 64-symbol alphabet, so any given id carries
        // the pair `u2` about one run in two hundred — and it duly failed on an
        // id of `yFTngT9NULM83RTbHDDu2` while `userId` was correctly `u1`. A
        // test that fails on the shape of a random id is not testing tenancy.
        const res = await getSplitsAs('u1', 'inspector');
        const body = await res.json() as { data: { splits: Record<string, unknown>[] } };

        const foreign = body.data.splits.flatMap((split, i) =>
            Object.entries(split)
                .filter(([, v]) => v === 'u2')
                .map(([k]) => `splits[${i}].${k}`));
        expect(foreign).toEqual([]);
        // Not vacuous: there IS a split, and it is the requester's own.
        expect(body.data.splits.map(s => s.userId)).toEqual(['u1']);
    });

    it("positive control — the same check DOES see a colleague when one is returned", async () => {
        // Without this, the assertion above would pass just as happily against
        // an endpoint that returned nothing at all, or against a payload whose
        // user field had been renamed out from under it.
        const res = await getSplitsAs('mgr', 'manager');
        const body = await res.json() as { data: { splits: Record<string, unknown>[] } };

        const foreign = body.data.splits.flatMap((split, i) =>
            Object.entries(split)
                .filter(([, v]) => v === 'u2')
                .map(([k]) => `splits[${i}].${k}`));
        expect(foreign.length).toBeGreaterThan(0);
    });

    it('a manager sees every split on the inspection, editable', async () => {
        const res = await getSplitsAs('mgr', 'manager');
        const body = await res.json() as { data: { splits: { userId: string }[]; scope: string; canEdit: boolean } };
        expect(body.data.splits.map(s => s.userId).sort()).toEqual(['u1', 'u2']);
        expect(body.data.scope).toBe('all');
        expect(body.data.canEdit).toBe(true);
    });

    it('the line is the CAPABILITY, not the role — an inspector granted financial sees everyone', async () => {
        // The mirror test: if this returned one row, the scoping would be
        // keyed on the role tier and the override would be decorative.
        const res = await getSplitsAs('u1', 'inspector', { financial: true });
        const body = await res.json() as { data: { splits: { userId: string }[] } };
        expect(body.data.splits.map(s => s.userId).sort()).toEqual(['u1', 'u2']);
    });

    it('a manager whose financial override is revoked drops to their own rows', async () => {
        const res = await getSplitsAs('u2', 'manager', { financial: false });
        const body = await res.json() as { data: { splits: { userId: string }[]; scope: string } };
        expect(body.data.splits.map(s => s.userId)).toEqual(['u2']);
        expect(body.data.scope).toBe('self');
    });
});

describe('writing pay — an agreement only one side can move is not an agreement', () => {
    it('an inspector cannot edit a split, including their own', async () => {
        const res = await patchSplitAs('u1', 'inspector', await splitIdFor('u1'));
        expect(res.status).toBe(403);
    });

    it('an inspector granted financial still cannot edit — the write is role-gated too', async () => {
        const res = await patchSplitAs('u1', 'inspector', await splitIdFor('u1'), { financial: true });
        expect(res.status).toBe(403);
    });

    it('a manager can edit', async () => {
        const res = await patchSplitAs('mgr', 'manager', await splitIdFor('u1'));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { amountCents: number; source: string } };
        expect(body.data).toMatchObject({ amountCents: 20000, source: 'manual' });
    });

    it('a manager without financial cannot edit', async () => {
        const res = await patchSplitAs('mgr', 'manager', await splitIdFor('u1'), { financial: false });
        expect(res.status).toBe(403);
    });

    it('the split id must belong to the inspection in the path', async () => {
        const res = await patchSplitAs('mgr', 'manager', 'not-a-split-on-this-job');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/team/payroll-export — locking is financial work', () => {
    it('an inspector cannot export payroll', async () => {
        expect((await exportPayrollAs('u1', 'inspector')).status).toBe(403);
    });

    it('a manager without financial cannot export payroll', async () => {
        expect((await exportPayrollAs('mgr', 'manager', { financial: false })).status).toBe(403);
    });

    it('a manager exports and the rows come back locked', async () => {
        const res = await exportPayrollAs('mgr', 'manager');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { lockedCount: number; totalCents: number; splits: { lockedAtMs: number | null }[] } };
        expect(body.data.lockedCount).toBe(2);
        expect(body.data.totalCents).toBe(30000);
        expect(body.data.splits.every(s => s.lockedAtMs !== null)).toBe(true);
    });
});
