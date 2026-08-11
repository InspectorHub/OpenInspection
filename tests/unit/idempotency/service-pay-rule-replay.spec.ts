/**
 * Retry safety for the pay-rule write surface (#278).
 *
 * A pay rule is not itself money, but it is the multiplier every future split
 * on that service is derived from, so a duplicate is a money-shaped defect: two
 * rules in the same slot and `pickRule` picks one arbitrarily, which means what
 * an inspector earns depends on insertion order.
 *
 * The partial unique indexes stop the duplicate ROW. What they do not fix is
 * what a retry SEES: unguarded, the second POST of the same create is a 409
 * saying a rule already exists — indistinguishable, from the client's seat, from
 * a colleague having added one in another tab. The guard turns the retry into a
 * replay of the original 201, which is the honest answer: the request succeeded,
 * this is what it created. That is the difference these specs pin.
 *
 * PUT and DELETE are asserted for the same reason and are weaker hazards: PUT
 * writes an absolute rate, and a retried DELETE unguarded 404s on a rule that
 * the caller did in fact delete. Both are labelled for what they are.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { tenants, users, services, servicePayRules } from '../../../server/lib/db/schema';
import { ServiceService } from '../../../server/services/service.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { servicesRoutes } from '../../../server/api/services';

const T = 't1';
const SVC = 'svc-home';
// Assembled rather than written out, and this comment names no path either.
// `isVerified` in the coverage gate marks a route verified when a replay spec
// contains its full path as a QUOTED string — anywhere in the file, comments
// included. Writing the bare router mount out here would mark the create-service
// route, which this file does not exercise, as having a replay story. A false
// verification is worse than a pending entry, so the mount is built at runtime.
const MOUNT = ['/api', 'services'].join('/');
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
        c.set('user', { sub: 'mgr', role: 'manager', tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', { service: new ServiceService({} as D1Database) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route(MOUNT, servicesRoutes);
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

const RULES = `/api/services/${SVC}/pay-rules`;
const allRules = () => db.select().from(servicePayRules).where(eq(servicePayRules.tenantId, T)).all();

beforeEach(async () => {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    db = drizzle(fixture.sqlite, { schema }) as unknown as DrizzleD1Database;
    const now = new Date();

    await db.insert(tenants).values({
        id: T, slug: 'acme', tier: 'free', status: 'active',
        maxUsers: 5, deploymentMode: 'shared', createdAt: now,
    }).run();
    await db.insert(users).values({
        id: 'u1', tenantId: T, email: 'u1@acme.test', passwordHash: 'x',
        name: 'U1', role: 'inspector', createdAt: now,
    }).run();
    await db.insert(services).values({
        id: SVC, tenantId: T, name: 'Home Inspection', price: 50000, createdAt: now,
    }).run();
});

describe("POST '/api/services/{id}/pay-rules' — a replay must not read as someone else's rule", () => {
    const create = (key: string | null) => send('POST', RULES, key, { type: 'percent', percentBps: 6000 });

    it('answers the SAME 201 twice under one key, not a 409', async () => {
        const first = await create('rule-1');
        const second = await create('rule-1');

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
        expect(await allRules()).toHaveLength(1);
    });

    it('UNGUARDED, the retry is a 409 the caller cannot tell from a real clash', async () => {
        // The hazard, stated. The unique index does stop the second ROW — what
        // it cannot do is tell the retrying client that its own first attempt is
        // the thing in the way.
        expect((await create(null)).status).toBe(201);
        expect((await create(null)).status).toBe(409);
        expect(await allRules()).toHaveLength(1);
    });

    it('a DELIBERATE second rule under a fresh key still lands, for a different inspector', async () => {
        await create('rule-1');
        const other = await send('POST', RULES, 'rule-2', { type: 'percent', percentBps: 7000, userId: 'u1' });
        expect(other.status).toBe(201);
        expect(await allRules()).toHaveLength(2);
    });
});

describe("PUT '/api/services/{id}/pay-rules/{ruleId}' and DELETE '/api/services/{id}/pay-rules/{ruleId}'", () => {
    let ruleId: string;

    beforeEach(async () => {
        const body = await (await send('POST', RULES, 'seed', { type: 'percent', percentBps: 6000 }))
            .json() as { data: { id: string } };
        ruleId = body.data.id;
    });

    it('CHARACTERIZATION: PUT writes an absolute rate, so a replay is the same state', async () => {
        // Not evidence for the guard. Stated so that turning this into a
        // relative adjustment later fails HERE, loudly, rather than in payroll.
        const path = `${RULES}/${ruleId}`;
        await send('PUT', path, 'set-1', { type: 'fixed', amountCents: 15000 });
        await send('PUT', path, 'set-1', { type: 'fixed', amountCents: 15000 });

        const rows = await allRules();
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(15000);
    });

    it('DELETE replays its 200 instead of 404ing on the caller\'s own success', async () => {
        const path = `${RULES}/${ruleId}`;
        const first = await send('DELETE', path, 'del-1');
        const second = await send('DELETE', path, 'del-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(await allRules()).toHaveLength(0);
    });

    it('UNGUARDED, the retried DELETE 404s on a rule the caller did delete', async () => {
        const path = `${RULES}/${ruleId}`;
        expect((await send('DELETE', path, null)).status).toBe(200);
        expect((await send('DELETE', path, null)).status).toBe(404);
    });
});
