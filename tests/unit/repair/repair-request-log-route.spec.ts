/**
 * #69 — GET /api/inspections/:id/repair-requests, the Repair Request Log's
 * server side.
 *
 * Three things can only be proven here, at the HTTP boundary:
 *
 * 1. THE PUBLISH GATE FAILS CLOSED. The industry surface withholds the log
 *    until the report is published. The assertion is not "the response says
 *    published: false" — it is that the lists were NEVER QUERIED, because a
 *    gate that computes the answer and then declines to print it is one
 *    refactor away from printing it.
 * 2. RBAC IS MOUNTED. `requireRole` is middleware, and `createRoutesStub` does
 *    not run middleware (reference_createroutesstub_skips_middleware), so a
 *    component test asserting "staff only" would be fake-green. This drives the
 *    real router and reads the status code.
 * 3. THE SHARE TOKEN DOES NOT LEAK. `repair_requests` carries a live bearer
 *    credential for the client's own list. The route projects fields
 *    explicitly; this asserts the projection, so a future `...rr` spread that
 *    looks tidier fails here instead of shipping the token into a staff page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import inspectionRepairRequestRoutes from '../../../server/api/inspections/repair-requests';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = 't-repairlog-1';
const USER = 'u-repairlog-1';
const INSP = 'i-repairlog-1';

const ENV = { DB: {} } as never;
// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const CTX = makeExecutionContext().ctx;

const LIST_ROW = {
    id: 'rr1',
    tenantId: TENANT,
    inspectionId: INSP,
    createdByKind: 'client' as const,
    createdByRef: 'buyer@example.com',
    customIntro: null,
    // The credential the projection must not emit.
    shareToken: 'SECRET-SHARE-TOKEN',
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
    expiresAt: null,
    revokedAt: null,
    items: [
        {
            id: 'it1',
            tenantId: TENANT,
            repairRequestId: 'rr1',
            findingKey: 'k1',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
            commentSnapshot: 'Several shingles are cracked.',
            requestedCreditCents: 50000,
            note: 'Before closing, please.',
            sortOrder: 0,
            defectTitleSnapshot: 'Missing shingles',
            locationSnapshot: 'North slope',
            categorySnapshot: 'safety',
            tradeSnapshot: 'licensed roofer',
            repairActionTag: 'replace' as const,
        },
    ],
};

async function callLog(opts: {
    reportStatus: 'in_progress' | 'submitted' | 'published';
    role?: 'owner' | 'manager' | 'inspector' | 'client';
    inspectionExists?: boolean;
}) {
    const { reportStatus, role = 'owner', inspectionExists = true } = opts;
    const fixture = createTestDb();
    const db = fixture.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({ id: TENANT, slug: 't-repairlog', createdAt: new Date() });
    if (inspectionExists) {
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-07-01', createdAt: new Date(), price: 0, reportStatus,
        } as never);
    }

    const listForInspection = vi.fn().mockResolvedValue([LIST_ROW]);

    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('user', { sub: USER, role, tenantId: TENANT } as never);
        c.set('tenantId', TENANT);
        c.set('services', { repairRequest: { listForInspection } } as never);
        await next();
    });
    app.route('/api/inspections', inspectionRepairRequestRoutes);
    const res = await app.request(`/api/inspections/${INSP}/repair-requests`, {}, ENV, CTX);
    return { res, listForInspection };
}

describe('GET /:id/repair-requests — the publish gate', () => {
    beforeEach(() => vi.clearAllMocks());

    it('never even queries the lists while the report is unpublished', async () => {
        const { res, listForInspection } = await callLog({ reportStatus: 'in_progress' });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { published: boolean; lists: unknown[] } };
        expect(body.data.published).toBe(false);
        expect(body.data.lists).toEqual([]);
        // The load-bearing assertion. `lists: []` alone would also hold if the
        // handler fetched every list and then discarded them.
        expect(listForInspection).not.toHaveBeenCalled();
    });

    it('withholds the log at `submitted` too — submitted is not delivered', async () => {
        const { res, listForInspection } = await callLog({ reportStatus: 'submitted' });
        const body = await res.json() as { data: { published: boolean } };
        expect(body.data.published).toBe(false);
        expect(listForInspection).not.toHaveBeenCalled();
    });

    it('returns the log once the report is published', async () => {
        const { res, listForInspection } = await callLog({ reportStatus: 'published' });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            data: { published: boolean; propertyAddress: string; lists: Array<{ id: string; items: unknown[] }> };
        };
        expect(body.data.published).toBe(true);
        expect(body.data.propertyAddress).toBe('1 Main St');
        expect(body.data.lists.map((l) => l.id)).toEqual(['rr1']);
        expect(body.data.lists[0]?.items).toHaveLength(1);
        expect(listForInspection).toHaveBeenCalledWith(TENANT, INSP);
    });

    it('404s an inspection that is not this tenant\'s, before any list read', async () => {
        const { res, listForInspection } = await callLog({
            reportStatus: 'published',
            inspectionExists: false,
        });
        expect(res.status).toBe(404);
        expect(listForInspection).not.toHaveBeenCalled();
    });
});

describe('GET /:id/repair-requests — who may read it', () => {
    beforeEach(() => vi.clearAllMocks());

    it('admits the same three staff roles the hub payload does', async () => {
        for (const role of ['owner', 'manager', 'inspector'] as const) {
            const { res } = await callLog({ reportStatus: 'published', role });
            expect(res.status, `role ${role}`).toBe(200);
        }
    });

    it('refuses a role outside that set', async () => {
        // requireRole is MIDDLEWARE. This spec drives the real router precisely
        // because a component-level test would never run it.
        const { res, listForInspection } = await callLog({ reportStatus: 'published', role: 'client' });
        expect(res.status).toBe(403);
        expect(listForInspection).not.toHaveBeenCalled();
    });
});

describe('GET /:id/repair-requests — what it does NOT return', () => {
    beforeEach(() => vi.clearAllMocks());

    it('emits no share token', async () => {
        const { res } = await callLog({ reportStatus: 'published' });
        const raw = await res.text();
        // Asserted on the serialized body, not on a parsed field: the point is
        // that the credential is absent from the bytes the page receives, at
        // whatever depth a future spread might place it.
        expect(raw).not.toContain('SECRET-SHARE-TOKEN');
        expect(raw).not.toContain('shareToken');
    });
});
