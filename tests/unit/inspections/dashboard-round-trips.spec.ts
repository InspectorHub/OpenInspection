/**
 * How long GET /api/inspections/dashboard waits on D1, counted in round trips.
 *
 * Each statement a Worker sends to D1 is a network round trip (60-150 ms in
 * production), and SQL execution is sub-millisecond, so the response time of
 * this route is the number of SEQUENTIAL round trips times that figure. It used
 * to run its dozen reads one after another: about 1.9 s warm, measured against
 * a production company, for a page that needs well under a quarter of that.
 *
 * What is counted is `waves` (see helpers/round-trip-recorder.ts): a statement
 * that starts while no other is in flight begins a new wave, so reads issued
 * together are one wave however many there are. The route's own chain is:
 *
 *   wave 1  the middleware's configuration reads (shared by every route)
 *   wave 2  everything that needs only the company id: the inspection set, the
 *           attention thresholds, signed agreements, invoices, service lines,
 *           the concierge count and the caller's capabilities
 *   wave 3  everything that needs the inspection set: defect results, agent
 *           names and inspector names
 *
 * An inspector whose access is limited to their assigned inspections pays one
 * more wave first, because the set they may see depends on their capabilities.
 *
 * The recorder sleeps before every call, so the overlap is real wall-clock
 * overlap, not an accident of microtask order. The slug lookups in the
 * middleware hit the cache after a warm-up call, as they do in production.
 *
 * Statement counts are printed next to the wave counts: a budget that printed
 * only a verdict could not be audited, and a recorder that stopped counting
 * would read as a triumph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';
import { FIXED_NOW, MANAGER_ID, seedDashboard } from '../helpers/dashboard-fixture';
import { measureWall, recordRoundTrips, wallWithinBudget, type RoundTripLog } from '../helpers/round-trip-recorder';

const LATENCY_MS = 100;

async function measure(h: Harness, sub: string, role: string): Promise<RoundTripLog & { ms: number; base: number }> {
    const rec = recordRoundTrips(h.env.DB as D1Database, LATENCY_MS);
    (h.env as unknown as Record<string, unknown>).DB = rec.binding;
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': role, iat, exp: iat + 3600 }, keyring);
    const call = async () => {
        const exec = makeExecutionContext({ label: 'dashboard' });
        const res = await app.request('/api/inspections/dashboard', { headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        expect(res.status).toBe(200);
    };
    // Warm the caches the middleware fills on first use. Two calls: the first resolves the tenant from
    // the database, the second is the first to reach the slug lookup that depends on that answer.
    await call();
    await call();
    const { base, ms } = await measureWall(rec, LATENCY_MS, call);
    return { ...rec.log, sql: [...rec.log.sql], ms, base };
}

describe('dashboard round-trip budget', () => {
    let h: Harness;
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW); });
    afterEach(() => { h?.close(); vi.useRealTimers(); });

    const report = (who: string, m: RoundTripLog & { ms: number; base: number }, budget: number) => {
        // ROUNDTRIP_SQL=1 prints each statement with the wave it started in.
        if (process.env.ROUNDTRIP_SQL) console.log(m.sql.map((q) => '  ' + q.slice(0, 100)).join(String.fromCharCode(10)));
        console.log(`dashboard ${who}: statements=${m.statements} roundTrips=${m.roundTrips} waves=${m.waves} budget=${budget} wall=${m.ms.toFixed(0)}ms (base ${m.base.toFixed(0)}ms) at ${LATENCY_MS}ms per call`);
        // The wall clock agrees with the wave count: nothing hides a serial chain from both. Relative to the
        // request's own cost on this machine, so a slow machine does not loosen it.
        expect(wallWithinBudget(m, budget, LATENCY_MS), `wall ${m.ms.toFixed(0)}ms vs base ${m.base.toFixed(0)}ms + ${budget + 1} x ${LATENCY_MS}ms`).toBe(true);
    };


    it('an owner waits for at most three sequential round trips', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        const m = await measure(h, OWNER_ID, 'owner');
        report('owner', m, 3);
        expect(m.statements, 'the recorder counted nothing - the instrument is broken').toBeGreaterThan(0);
        expect(m.waves).toBeLessThanOrEqual(3);
    });

    it('a manager waits for at most three', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        const m = await measure(h, MANAGER_ID, 'manager');
        report('manager', m, 3);
        expect(m.statements).toBeGreaterThan(0);
        expect(m.waves).toBeLessThanOrEqual(3);
    });

    it('an inspector limited to assigned inspections waits for at most four', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        const m = await measure(h, INSPECTOR_ID, 'inspector');
        report('inspector', m, 4);
        expect(m.statements).toBeGreaterThan(0);
        expect(m.waves).toBeLessThanOrEqual(4);
    });

    it('an empty company does not pay for work it has none of', async () => {
        h = await createHarness('standalone');
        const m = await measure(h, OWNER_ID, 'owner');
        report('empty owner', m, 3);
        expect(m.statements).toBeGreaterThan(0);
        expect(m.waves).toBeLessThanOrEqual(3);
    });
});
