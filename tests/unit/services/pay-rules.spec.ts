/**
 * The switch for pay splits (#278).
 *
 * Tasks 1-4 shipped the schema, the populate logic, the API surface and the
 * metrics — but nothing could create a `service_pay_rules` row, so
 * `populateSplits` had nothing to read and the whole feature was a machine with
 * no switch. These are the specs for the write face.
 *
 * Three of them are load-bearing and the rest is scaffolding:
 *
 *   1. THE UNIT CONTRACT. `service_pay_rules.value` is basis points for a
 *      percentage and integer cents for `fixed` — one column, two units. A
 *      wire field also called `value` would carry that ambiguity to every
 *      caller, and `60` meaning 0.6% when the caller meant 60% is a 100× money
 *      error that no type checks. So `value` never appears on the wire at all:
 *      each variant names its own unit (`percentBps` / `amountCents`) and the
 *      objects are STRICT, so a payload written in the wrong unit-name fails
 *      loudly instead of being stored a hundred times too small.
 *   2. THE SECOND DEFAULT. Two partial unique indexes make a duplicate rule a
 *      DB-level refusal; the client must see a 409 it can act on, never a raw
 *      SQLite constraint string.
 *   3. `percent` + `deductionCents`. The deduction is meaningful only for
 *      `percent_after_deduction` (it comes off the top BEFORE the percentage).
 *      A `percent` rule carrying one is ambiguous, so it is refused rather than
 *      silently ignored — which is what a single loose object would have done.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import {
    tenants, users, services, inspections, inspectionServices, servicePayRules,
    inspectionServicePaySplits,
} from '../../../server/lib/db/schema';
import { syncInspectionAssignments } from '../../../server/lib/db/assignment-links';
import { populateSplits } from '../../../server/services/pay-split.service';
import { loadRules, pickRule } from '../../../server/services/pay-split/core';
import { ServiceService } from '../../../server/services/service.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { servicesRoutes } from '../../../server/api/services';
import { makeExecutionContext } from '../helpers/exec-ctx';

const T = 't1';
const SVC = 'svc-home';
const INSP = 'i1';
const LINE = 'line1';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];
// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const CTX = makeExecutionContext().ctx;

let db: DrizzleD1Database;

function buildApp(role: 'owner' | 'manager' | 'inspector' = 'manager') {
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
        c.set('user', { sub: 'mgr', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', { service: new ServiceService({} as D1Database) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/services', servicesRoutes);
    return app;
}

function send(method: string, path: string, body?: unknown, role?: 'owner' | 'manager' | 'inspector') {
    return buildApp(role).fetch(
        new Request(`https://acme.example.com${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
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
});

/* ------------------------------------------------------------------ */
/*  1. The unit contract                                               */
/* ------------------------------------------------------------------ */

describe('the unit contract for a percentage rule', () => {
    it('stores `percentBps: 6000` as 6000 basis points and pays 60%', async () => {
        const res = await send('POST', RULES, { type: 'percent', percentBps: 6000 });
        expect(res.status).toBe(201);

        const rows = await allRules();
        expect(rows).toHaveLength(1);
        // The column is basis points here, and this is the assertion that says so.
        expect(rows[0].value).toBe(6000);

        await syncInspectionAssignments(db, T, INSP, { leadInspectorId: 'u1', helperInspectorIds: [] });
        await populateSplits(db, T, INSP);
        const splits = await db.select().from(inspectionServicePaySplits)
            .where(eq(inspectionServicePaySplits.tenantId, T)).all();
        // 60% of $500.00 — NOT 0.6% ($3.00), which is what a human "60" written
        // straight into the column would have produced.
        expect(splits[0].amountCents).toBe(30000);
    });

    it('REFUSES a human percent sent as `percent`, rather than storing 0.6%', async () => {
        // The 100× error, attempted. A loose object would drop the unknown key
        // and fail on a missing `percentBps`; a strict one names the mistake.
        const res = await send('POST', RULES, { type: 'percent', percent: 60 });
        expect(res.status).toBe(400);
        expect(await allRules()).toHaveLength(0);
    });

    it('REFUSES the ambiguous wire field `value`, whichever unit the caller meant', async () => {
        const res = await send('POST', RULES, { type: 'percent', value: 6000 });
        expect(res.status).toBe(400);
        expect(await allRules()).toHaveLength(0);
    });

    it('accepts the whole legal basis-point range and nothing above 100%', async () => {
        // 1 bp = 0.01%, the smallest expressible share.
        expect((await send('POST', RULES, { type: 'percent', percentBps: 1, userId: 'u1' })).status).toBe(201);
        // 10000 bp = 100%. Legal on its own: with two eligible inspectors it
        // pays 50% each and the line sums to exactly its price.
        expect((await send('POST', RULES, { type: 'percent', percentBps: 10000, userId: 'u2' })).status).toBe(201);
        // Above 100% the GROSS exceeds the line price for every roster size
        // (the divisor cancels), so no such rule can ever populate. Refusing it
        // is not the split-ceiling check — that stays at populate time.
        expect((await send('POST', RULES, { type: 'percent', percentBps: 10001 })).status).toBe(400);
        expect((await send('POST', RULES, { type: 'percent', percentBps: 0 })).status).toBe(400);
    });

    it('names cents `amountCents` on a fixed rule, and the same column holds cents', async () => {
        const res = await send('POST', RULES, { type: 'fixed', amountCents: 12500 });
        expect(res.status).toBe(201);
        expect((await allRules())[0].value).toBe(12500);
        // And the response never echoes the dual-unit column name back.
        const body = await res.json() as { data: Record<string, unknown> };
        expect(body.data).toMatchObject({ type: 'fixed', amountCents: 12500 });
        expect(body.data).not.toHaveProperty('value');
    });
});

/* ------------------------------------------------------------------ */
/*  2. The second default                                              */
/* ------------------------------------------------------------------ */

describe('the partial unique indexes, surfaced', () => {
    it('a SECOND default rule for one service is a 409, not a SQLite error', async () => {
        expect((await send('POST', RULES, { type: 'percent', percentBps: 6000 })).status).toBe(201);

        const second = await send('POST', RULES, { type: 'percent', percentBps: 5500 });
        expect(second.status).toBe(409);
        const body = await second.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe('conflict');
        // Actionable, and free of driver noise.
        expect(body.error.message).toMatch(/already has a default pay rule/i);
        expect(body.error.message).not.toMatch(/UNIQUE constraint|SQLITE/i);
        // The first rule is untouched — a refused create never half-writes.
        const rows = await allRules();
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(6000);
    });

    it('a second rule for the SAME inspector is a 409 naming that inspector', async () => {
        expect((await send('POST', RULES, { type: 'percent', percentBps: 6000, userId: 'u1' })).status).toBe(201);
        const second = await send('POST', RULES, { type: 'fixed', amountCents: 9000, userId: 'u1' });
        expect(second.status).toBe(409);
        expect(await allRules()).toHaveLength(1);
    });

    it('a default AND a per-inspector rule coexist, and the specific one wins', async () => {
        await send('POST', RULES, { type: 'percent', percentBps: 6000 });
        await send('POST', RULES, { type: 'percent', percentBps: 7000, userId: 'u1' });
        expect(await allRules()).toHaveLength(2);

        // The reason the default row exists at all: `pickRule` precedence.
        const rules = await loadRules(db, T, [SVC]);
        expect(pickRule(rules, SVC, 'u1')?.value).toBe(7000);
        expect(pickRule(rules, SVC, 'u2')?.value).toBe(6000);
    });
});

/* ------------------------------------------------------------------ */
/*  3. `percent` carrying a deduction                                  */
/* ------------------------------------------------------------------ */

describe('deductionCents belongs to exactly one type', () => {
    it('REFUSES `percent` + deductionCents instead of silently dropping it', async () => {
        const res = await send('POST', RULES, { type: 'percent', percentBps: 6000, deductionCents: 5000 });
        expect(res.status).toBe(400);
        expect(await allRules()).toHaveLength(0);
    });

    it('REFUSES `fixed` + deductionCents for the same reason', async () => {
        const res = await send('POST', RULES, { type: 'fixed', amountCents: 9000, deductionCents: 5000 });
        expect(res.status).toBe(400);
        expect(await allRules()).toHaveLength(0);
    });

    it('takes the deduction off the top BEFORE the percentage on the type that owns it', async () => {
        const res = await send('POST', RULES, {
            type: 'percent_after_deduction', percentBps: 6000, deductionCents: 10000,
        });
        expect(res.status).toBe(201);
        expect((await allRules())[0].deductionCents).toBe(10000);

        await syncInspectionAssignments(db, T, INSP, { leadInspectorId: 'u1', helperInspectorIds: [] });
        await populateSplits(db, T, INSP);
        const splits = await db.select().from(inspectionServicePaySplits)
            .where(eq(inspectionServicePaySplits.tenantId, T)).all();
        // ($500.00 − $100.00) × 60% = $240.00. Not 60% of $500 less $100 ($200),
        // which is the arithmetic a "percent with a discount" reading produces.
        expect(splits[0].amountCents).toBe(24000);
    });
});

/* ------------------------------------------------------------------ */
/*  The rest of the write face                                         */
/* ------------------------------------------------------------------ */

describe('list, update, delete', () => {
    it('lists the rules of one service, default first', async () => {
        await send('POST', RULES, { type: 'percent', percentBps: 7000, userId: 'u1' });
        await send('POST', RULES, { type: 'percent', percentBps: 6000 });

        const body = await (await send('GET', RULES)).json() as { data: { userId: string | null }[] };
        expect(body.data.map(r => r.userId)).toEqual([null, 'u1']);
    });

    it('updates a rule in place, including switching its type', async () => {
        const created = await (await send('POST', RULES, { type: 'percent', percentBps: 6000 }))
            .json() as { data: { id: string } };
        const res = await send('PUT', `${RULES}/${created.data.id}`, { type: 'fixed', amountCents: 15000 });
        expect(res.status).toBe(200);

        const rows = await allRules();
        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('fixed');
        expect(rows[0].value).toBe(15000);
        // Switching away from percent_after_deduction must clear the deduction,
        // or a stale one silently changes the arithmetic of the new type.
        expect(rows[0].deductionCents).toBeNull();
    });

    it('deletes a rule, which turns the feature back off for that service', async () => {
        const created = await (await send('POST', RULES, { type: 'percent', percentBps: 6000 }))
            .json() as { data: { id: string } };
        expect((await send('DELETE', `${RULES}/${created.data.id}`)).status).toBe(200);
        expect(await allRules()).toHaveLength(0);

        await syncInspectionAssignments(db, T, INSP, { leadInspectorId: 'u1', helperInspectorIds: [] });
        expect(await populateSplits(db, T, INSP)).toBe(0);
    });

    it('404s on a service that is not this tenant\'s, and on an unknown rule', async () => {
        expect((await send('POST', '/api/services/nope/pay-rules', { type: 'percent', percentBps: 6000 })).status)
            .toBe(404);
        expect((await send('DELETE', `${RULES}/nope`)).status).toBe(404);
    });

    it('refuses a userId that is not a tenant member', async () => {
        const res = await send('POST', RULES, { type: 'percent', percentBps: 6000, userId: 'stranger' });
        expect(res.status).toBe(400);
        expect(await allRules()).toHaveLength(0);
    });
});

describe('who may set what a person is paid', () => {
    it('an inspector may not write a pay rule', async () => {
        const res = await send('POST', RULES, { type: 'percent', percentBps: 6000 }, 'inspector');
        expect(res.status).toBe(403);
        expect(await allRules()).toHaveLength(0);
    });

    it('an owner may', async () => {
        expect((await send('POST', RULES, { type: 'percent', percentBps: 6000 }, 'owner')).status).toBe(201);
    });
});
