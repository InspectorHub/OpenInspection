/**
 * Retry safety for `PATCH /api/inspections/{id}/reports/{reportId}/narrative`.
 *
 * The route replaces the inspector's report-level narrative wholesale, so it is
 * naturally idempotent — and that claim is worth asserting rather than writing
 * into a baseline as a sentence, because "naturally idempotent" is exactly what
 * an APPEND would also look like from the call site. The distinguishing test is
 * the last one here: two DIFFERENT texts under two keys must both land, which a
 * route that accumulated (or that replayed the wrong body) would fail.
 *
 * The narrative carries professional liability, which raises the cost of the
 * failure the guard prevents in the other direction too: a replayed save that
 * quietly kept an older draft would leave a report published with text the
 * inspector believes they replaced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { tenants, inspections, reports } from '../../../server/lib/db/schema';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const T = 't1';
const INSP = 'i1';
const REPORT = 'rep1';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

const FIRST = 'The roof covering is at the end of its service life.';
const SECOND = 'The roof covering is at the end of its service life, and the flashing is corroded.';

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
        c.set('userRole', 'inspector');
        c.set('user', { sub: 'u1', role: 'inspector', tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

function patchNarrative(key: string | null, inspectorNarrative: string | null) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request(`https://acme.example.com/api/inspections/${INSP}/reports/${REPORT}/narrative`, {
            method: 'PATCH', headers, body: JSON.stringify({ inspectorNarrative }),
        }),
        FAKE_ENV as never, CTX,
    );
}

const stored = async () =>
    (await db.select({ n: reports.inspectorNarrative }).from(reports).where(eq(reports.id, REPORT)).get())?.n ?? null;

beforeEach(async () => {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    db = drizzle(fixture.sqlite, { schema }) as unknown as DrizzleD1Database;
    const now = new Date();
    await db.insert(tenants).values({
        id: T, slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: now,
    }).run();
    await db.insert(inspections).values({
        id: INSP, tenantId: T, propertyAddress: '1 Oak St', date: '2026-08-01', createdAt: now,
    }).run();
    await db.insert(reports).values({
        id: REPORT, tenantId: T, inspectionId: INSP, kind: 'primary',
        title: 'Inspection Report', status: 'in_progress', createdAt: now, sortOrder: 0,
    }).run();
});

describe("PATCH '/api/inspections/{id}/reports/{reportId}/narrative' — a replay must store the same text", () => {
    it('two patches under one key leave exactly the text that was sent', async () => {
        const first = await patchNarrative('nar-1', FIRST);
        const second = await patchNarrative('nar-1', FIRST);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await stored()).toBe(FIRST);
    });

    it('replays the original response, flagged', async () => {
        const first = await patchNarrative('nar-1', FIRST);
        const second = await patchNarrative('nar-1', FIRST);
        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('UNGUARDED, the same patch twice is still one narrative — the write is a replace', async () => {
        // Stated as characterization, not as evidence for the guard: this route
        // is safe on its own because it overwrites. A route that appended would
        // fail here, which is the difference the baseline sentence could not
        // demonstrate.
        await patchNarrative(null, FIRST);
        await patchNarrative(null, FIRST);
        expect(await stored()).toBe(FIRST);
    });

    it('a DELIBERATE revision under a fresh key replaces the text', async () => {
        await patchNarrative('nar-1', FIRST);
        await patchNarrative('nar-2', SECOND);
        expect(
            await stored(),
            'the second save was swallowed; an inspector who revised their narrative would publish the old one',
        ).toBe(SECOND);
    });

    it('clearing it under a fresh key stores NULL', async () => {
        await patchNarrative('nar-1', FIRST);
        await patchNarrative('nar-2', null);
        expect(await stored()).toBeNull();
    });
});
