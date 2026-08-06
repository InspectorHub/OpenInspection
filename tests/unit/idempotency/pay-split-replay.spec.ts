/**
 * Retry safety for the pay-split write surface (#278).
 *
 * Two of these four routes have a real hazard and two are naturally contained;
 * all four are asserted here rather than argued about in a baseline entry,
 * because they are the routes that decide what a person is paid.
 *
 *   - POST .../corrections is the dangerous one. A correction is a NEW ROW
 *     carrying a delta, so an unguarded retry pays the delta TWICE and the
 *     ledger looks internally consistent while doing it.
 *   - POST /api/team/payroll-export is dangerous in the opposite direction:
 *     exporting LOCKS the rows it returns, so a replay that re-ran the handler
 *     would hand the operator an EMPTY run and the money would read as unowed.
 *   - PATCH .../{splitId} sets an absolute amount and POST .../refresh
 *     re-derives to a fixed point, so both survive a replay on their own. They
 *     are asserted as characterization, labelled as such, so nobody later reads
 *     them as evidence for the guard.
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
import { populateSplits, exportPayroll } from '../../../server/services/pay-split.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
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
const MGR = 'mgr';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

let db: DrizzleD1Database;

function buildApp() {
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
        c.set('userRole', 'manager');
        c.set('user', { sub: MGR, role: 'manager', tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/inspections', inspectionsRoutes);
    app.route('/api/team', teamRoutes);
    return app;
}

function send(method: string, path: string, key: string | null, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request(`https://acme.example.com${path}`, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        }),
        FAKE_ENV as never, CTX,
    );
}

const allSplits = () => db.select().from(inspectionServicePaySplits)
    .where(eq(inspectionServicePaySplits.tenantId, T)).all();

const splitIdFor = async (userId: string) => {
    const row = await db.select().from(inspectionServicePaySplits)
        .where(and(
            eq(inspectionServicePaySplits.tenantId, T),
            eq(inspectionServicePaySplits.userId, userId),
        ))
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
        id: T, name: 'Acme', slug: 'acme', tier: 'free', status: 'active',
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
    await syncInspectionAssignments(db, T, INSP, { leadInspectorId: 'u1', helperInspectorIds: ['u2'] });
    await populateSplits(db, T, INSP);
});

describe("POST '/api/inspections/{id}/pay-splits/{splitId}/corrections' — a replay must not pay the delta twice", () => {
    let lockedId: string;

    beforeEach(async () => {
        // A correction is only legal against an EXPORTED row, so lock first.
        await exportPayroll(db, T, { fromMs: 0, toMs: Date.now() + 86_400_000 });
        lockedId = await splitIdFor('u1');
    });

    const correct = (key: string | null) => send(
        'POST', `/api/inspections/${INSP}/pay-splits/${lockedId}/corrections`, key,
        { amountCents: 5000, reason: 'Agreed uplift for the crawlspace' },
    );

    it('writes ONE correction row across two posts under one key', async () => {
        const first = await correct('corr-1');
        const second = await correct('corr-1');

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        const corrections = (await allSplits()).filter(s => s.correctsSplitId !== null);
        expect(corrections).toHaveLength(1);
        expect(corrections[0].amountCents).toBe(5000);
    });

    it('replays the original response, flagged', async () => {
        const first = await correct('corr-1');
        const second = await correct('corr-1');
        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('a DELIBERATE second correction under a fresh key still lands', async () => {
        await correct('corr-1');
        await correct('corr-2');
        expect((await allSplits()).filter(s => s.correctsSplitId !== null)).toHaveLength(2);
    });

    it('UNGUARDED, the same post twice pays the delta twice — the hazard, stated', async () => {
        // No key: the guard cannot key on anything, and both posts write.
        await correct(null);
        await correct(null);
        expect((await allSplits()).filter(s => s.correctsSplitId !== null)).toHaveLength(2);
    });
});

describe("POST '/api/team/payroll-export' — a replay must not report an empty run", () => {
    // A FIXED period, not `Date.now() + …`: the guard fingerprints the body, so
    // a period that moves between calls is a different request under the same
    // key and the endpoint correctly answers 422 instead of replaying. That
    // failure mode passes a naive "nothing was double-locked" assertion, which
    // is exactly the kind of green this spec exists to refuse.
    const PERIOD = { fromMs: 0, toMs: 4_102_444_800_000 };
    const exportRun = (key: string | null) => send('POST', '/api/team/payroll-export', key, PERIOD);

    it('returns the SAME run twice under one key, not an empty second one', async () => {
        const first = await exportRun('pay-1');
        const second = await exportRun('pay-1');
        const a = await first.json() as { data: { lockedCount: number; totalCents: number } };
        const b = await second.json() as { data: { lockedCount: number; totalCents: number } };

        expect(a.data.lockedCount).toBe(2);
        // Re-running the handler would lock nothing (every row is already
        // locked) and the operator's retry would read as "no pay was owed".
        expect(b.data).toEqual(a.data);
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    });

    it('locks each row once — a replay does not restamp locked_at', async () => {
        const first = await exportRun('pay-1');
        const body = await first.json() as { data: { splits: { id: string; lockedAtMs: number }[] } };
        const before = new Map(body.data.splits.map(s => [s.id, s.lockedAtMs]));
        await exportRun('pay-1');

        for (const row of await allSplits()) {
            expect(Number(row.lockedAt)).toBe(before.get(row.id));
        }
    });
});

describe("PATCH '/api/inspections/{id}/pay-splits/{splitId}' and POST '/api/inspections/{id}/pay-splits/refresh'", () => {
    it('CHARACTERIZATION: setting an absolute amount survives a replay on its own', async () => {
        // Not evidence for the guard. The route writes a value, not a delta, so
        // a second identical write is the same state. Stated rather than left
        // for someone to rediscover by turning it into a delta later — at which
        // point this assertion is the one that should be rewritten, loudly.
        const id = await splitIdFor('u1');
        const path = `/api/inspections/${INSP}/pay-splits/${id}`;
        await send('PATCH', path, 'set-1', { amountCents: 20000 });
        await send('PATCH', path, 'set-1', { amountCents: 20000 });

        const rows = (await allSplits()).filter(s => s.id === id);
        expect(rows).toHaveLength(1);
        expect(rows[0].amountCents).toBe(20000);
    });

    it('CHARACTERIZATION: refresh re-derives to a fixed point, so a replay changes nothing', async () => {
        const path = `/api/inspections/${INSP}/pay-splits/refresh`;
        const first = await send('POST', path, 'ref-1');
        const second = await send('POST', path, 'ref-1');
        expect(await second.json()).toEqual(await first.clone().json());
        expect((await allSplits()).map(s => s.amountCents).sort()).toEqual([15000, 15000]);
    });
});
