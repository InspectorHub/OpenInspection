/**
 * Retry safety for `POST /api/ai/reviews` (#61).
 *
 * The route is contained by its OWN dedup, not by the mounted guard: a unique
 * index on (tenant, artifact type, artifact id, ai call, reviewer) plus
 * `ON CONFLICT DO NOTHING`. That is asserted here rather than declared in a
 * baseline entry, because "naturally idempotent" is a claim about behaviour and
 * this file is the only thing that can check it.
 *
 * ⚠️ WHY `ON CONFLICT` AND NOT READ-THEN-INSERT. Two concurrent retries would
 * both see no row and both insert; the unique index would then reject the second
 * with a 500 — turning a harmless replay into an error the client has to
 * interpret. The conflict clause makes the second write a no-op atomically.
 *
 * ⚠️ THE CONTROLS BELOW ARE NOT OPTIONAL. "One row after two calls" is satisfied
 * for free by an implementation that never inserts anything, so every dedup case
 * is paired with a case that MUST produce a second row. A second REVIEWER is two
 * facts, not a duplicate — that is what a four-eyes policy would want, and a key
 * that collapsed them would destroy the evidence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { drizzle as drizzleFor } from 'drizzle-orm/better-sqlite3';
import { aiContentReviews } from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import aiRoutes from '../../../server/api/ai';

const T = 't1';
const INSPECTOR = 'user-inspector';
const CALL = 'call-1';
const ARTIFACT = 'result-1';
/** ⚠️ Named as its own literal on purpose. The coverage gate looks for the
 *  route path quoted exactly (`specText.includes("'" + path + "'")`), so a
 *  path merely embedded inside a full URL string does not count as naming it.
 *  That strictness is right: it wants the route DECLARED, not incidentally
 *  contained in some other string. */
const PATH = '/api/ai/reviews';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

// The better-sqlite3 handle, typed as what it actually is. The route under
// test receives it through the mocked `drizzle-orm/d1` factory below; the spec
// itself only reads rows off it.
let db: ReturnType<typeof drizzleFor>;

function buildApp(userId: string) {
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
        c.set('user', { sub: userId, role: 'inspector', tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/ai', aiRoutes);
    return app;
}

function review(opts: { userId?: string; aiCallId?: string; artifactId?: string } = {}) {
    return buildApp(opts.userId ?? INSPECTOR).fetch(
        new Request(`https://acme.example.com${PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                artifactType: 'inspection_result',
                artifactId: opts.artifactId ?? ARTIFACT,
                aiCallId: opts.aiCallId ?? CALL,
            }),
        }),
        FAKE_ENV as never, CTX,
    );
}

const rows = () => db.select().from(aiContentReviews).where(eq(aiContentReviews.tenantId, T)).all();

beforeEach(async () => {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    db = drizzleFor(fixture.sqlite);
});


describe('POST /api/ai/reviews — retry safety', () => {
    it('replays as a no-op: the same person confirming twice is one fact', async () => {
        expect((await review()).status).toBe(200);
        expect((await review()).status).toBe(200);
        expect(await rows()).toHaveLength(1);
    });

    it('CONTROL — a second REVIEWER is a second row, not a duplicate', async () => {
        // Without this, the case above passes against a route that inserts
        // nothing at all. It is also the property a four-eyes policy needs.
        await review();
        await review({ userId: 'user-manager' });
        const all = await rows();
        expect(all).toHaveLength(2);
        expect(new Set(all.map((r) => r.reviewedBy))).toEqual(new Set([INSPECTOR, 'user-manager']));
    });

    it('CONTROL — a different AI call is a different review', async () => {
        // Re-running the assistant and reviewing the NEW output is a new fact
        // about a new call; collapsing it would lose the second review.
        await review();
        await review({ aiCallId: 'call-2' });
        expect(await rows()).toHaveLength(2);
    });

    it('reports success on the replay, not a conflict error', async () => {
        // A retry the client cannot distinguish from the first call is the whole
        // point. A 409 here would make every offline resend look like a failure.
        await review();
        const second = await review();
        expect(second.status).toBe(200);
        expect(await second.json()).toMatchObject({ success: true, data: { reviewed: true } });
    });
});
