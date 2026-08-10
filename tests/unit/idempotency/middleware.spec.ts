/**
 * One test per row of the middleware's behaviour table (plan Task 3).
 *
 * The handler increments a counter, so "it ran twice" is directly observable
 * rather than inferred from a response body.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { claimKey } from '../../../server/lib/idempotency/store';
import { fingerprint } from '../../../server/lib/idempotency/fingerprint';
import type { HonoConfig } from '../../../server/types/hono';

let db: ReturnType<typeof createTestDb>['db'];
let ran = 0;

const BODY = { address: '123 Main' };

type Handler = () => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

function buildApp(handler: Handler, tenantId = 't1') {
    // Typed with HonoConfig so `c.set('tenantId', ...)` resolves against the
    // same Variables map `idempotencyMiddleware` reads it from.
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('tenantId', tenantId);
        await next();
    });
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.post('/thing', async (c) => {
        const out = await handler();
        return c.json(out.body as Record<string, unknown>, out.status as 200);
    });
    return app;
}

function post(app: ReturnType<typeof buildApp>, key?: string, body: unknown = BODY) {
    return app.request('/thing', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: JSON.stringify(body),
    });
}

const ok = () => { ran++; return { status: 200, body: { id: 'abc' } }; };

describe('idempotencyMiddleware', () => {
    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        db = t.db;
        ran = 0;
    });

    it('passes through untouched when there is no Idempotency-Key header', async () => {
        const app = buildApp(ok);
        expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(200);
        expect(ran).toBe(2);
    });

    it('runs the handler on a claim and returns its response', async () => {
        const app = buildApp(ok);
        const res = await post(app, 'k1');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 'abc' });
        expect(res.headers.get('Idempotency-Replayed')).toBeNull();
        expect(ran).toBe(1);
    });

    it('replays the stored response without running the handler again', async () => {
        const app = buildApp(ok);
        const first = await post(app, 'k1');
        const second = await post(app, 'k1');
        expect(ran).toBe(1);
        expect(second.status).toBe(first.status);
        expect(await second.json()).toEqual({ id: 'abc' });
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    });

    it('releases the key when the handler fails, so a corrected retry is not locked out', async () => {
        const app = buildApp(() => { ran++; return { status: 400, body: { error: 'nope' } }; });
        expect((await post(app, 'k1')).status).toBe(400);
        expect((await post(app, 'k1')).status).toBe(400);
        expect(ran).toBe(2);
    });

    it('answers 409 while the first request is still in flight', async () => {
        const fp = await fingerprint('POST', '/thing', BODY);
        await claimKey(db as never, { tenantId: 't1', key: 'k1', fingerprint: fp, ttlMs: 86_400_000 });
        const app = buildApp(ok);
        const res = await post(app, 'k1');
        expect(res.status).toBe(409);
        expect(ran).toBe(0);
    });

    it('answers 422 IDEMPOTENCY_KEY_REUSED when the same key carries a different payload', async () => {
        const app = buildApp(ok);
        await post(app, 'k1', { address: 'A' });
        const res = await post(app, 'k1', { address: 'CORRECTED' });
        expect(res.status).toBe(422);
        expect((await res.json() as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(ran).toBe(1);
    });

    it('scopes the key to the tenant — the same key under another tenant is a different key', async () => {
        expect((await post(buildApp(ok, 't1'), 'shared')).status).toBe(200);
        expect((await post(buildApp(ok, 't2'), 'shared')).status).toBe(200);
        expect(ran).toBe(2);
    });

    it('two simultaneous requests with one key run the handler ONCE', async () => {
        // The handler is parked on a gate so the second request genuinely
        // overlaps the first. Firing both with Promise.all against the
        // synchronous test DB does NOT overlap — the first request completes
        // inside the second's microtask gap and the second gets a replay, so
        // the in-flight branch would never be exercised.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const app = buildApp(async () => { ran++; await gate; return { status: 200, body: { id: 'abc' } }; });

        const first = post(app, 'same-key');
        // ...and the second must meet a claim that ALREADY EXISTS. Firing it
        // straight after the first is a race the test used to lose under load:
        // if the first has not reached claimKey yet, BOTH claim, both enter the
        // handler, and both park on a gate that is only released after the
        // second returns — a deadlock that surfaces as a 5s timeout rather than
        // as a wrong answer. Waiting for the handler to be ENTERED is strictly
        // after the claim, so the overlap is ordered instead of hoped for.
        while (ran === 0) await new Promise((r) => setImmediate(r));
        const second = await post(app, 'same-key');
        release();
        const firstRes = await first;

        expect(ran).toBe(1);
        expect([firstRes.status, second.status].sort()).toEqual([200, 409]);
    });
});
