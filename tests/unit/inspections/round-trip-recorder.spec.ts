/**
 * The instrument behind the round-trip budgets, checked on its own, with the
 * negative controls a budget needs: a recorder that can only say "pass" is not
 * evidence. Each shape below has a known depth; the budget assertions are the
 * same ones the route specs make, and the ones that must fail do fail.
 */
import { describe, expect, it } from 'vitest';
import { measureWall, recordRoundTrips, wallWithinBudget } from '../helpers/round-trip-recorder';

function fakeD1(): D1Database {
    const stmt = { bind: () => stmt, all: async () => ({ results: [] }), run: async () => ({}), first: async () => null, raw: async () => [] };
    return { prepare: () => stmt, batch: async (list: unknown[]) => list.map(() => ({})) } as unknown as D1Database;
}

async function run(shape: (q: () => Promise<unknown>, batch: (n: number) => Promise<unknown>) => Promise<void>) {
    const rec = recordRoundTrips(fakeD1(), 10);
    const q = () => rec.binding.prepare('select 1').bind().all();
    const batch = (n: number) => rec.binding.batch(Array.from({ length: n }, () => rec.binding.prepare('select 1')));
    await shape(q, batch);
    return rec.log;
}

describe('round-trip recorder', () => {
    it('three awaited statements are depth 3 and fail a budget of 2', async () => {
        const log = await run(async (q) => { await q(); await q(); await q(); });
        expect(log.waves).toBe(3);
        expect(log.waves <= 2).toBe(false);
    });

    it('statements issued together are one wave however many there are', async () => {
        const log = await run(async (q) => { await Promise.all([q(), q(), q(), q(), q()]); });
        expect(log.waves).toBe(1);
        expect(log.statements).toBe(5);
    });

    it('a serial chain nested inside a Promise.all is counted in full and fails a budget of 2', async () => {
        const log = await run(async (q) => {
            await Promise.all([q(), (async () => { await q(); await q(); await q(); })(), q()]);
        });
        expect(log.waves).toBe(3);
        expect(log.waves <= 2).toBe(false);
    });

    it('a group that waits on an earlier group is a second wave', async () => {
        const log = await run(async (q) => { await Promise.all([q(), q()]); await Promise.all([q(), q(), q()]); });
        expect(log.waves).toBe(2);
    });

    it('a batch is one round trip and one wave', async () => {
        const log = await run(async (_q, batch) => { await batch(4); });
        expect(log.roundTrips).toBe(1);
        expect(log.statements).toBe(4);
        expect(log.waves).toBe(1);
    });

    it('reset starts a new count', async () => {
        const rec = recordRoundTrips(fakeD1(), 5);
        await rec.binding.prepare('x').bind().all();
        await rec.binding.prepare('x').bind().all();
        expect(rec.log.waves).toBe(2);
        rec.reset();
        await rec.binding.prepare('x').bind().all();
        expect(rec.log.waves).toBe(1);
    });

    describe('the wall-time bound (budget of 3 round trips at 40 ms)', () => {
        const serial = async (n: number) => {
            const rec = recordRoundTrips(fakeD1(), 40);
            const q = () => rec.binding.prepare('select 1').bind().all();
            const m = await measureWall(rec, 40, async () => { for (let i = 0; i < n; i++) await q(); });
            return { m, ok: wallWithinBudget(m, 3, 40) };
        };

        it('a request inside its budget passes', async () => {
            expect((await serial(3)).ok).toBe(true);
        });

        it('three extra serial reads fail it, and so do two', async () => {
            expect((await serial(6)).ok).toBe(false);
            expect((await serial(5)).ok).toBe(false);
        });

        it('the base is the request without any delay, so it does not loosen the bound', async () => {
            const { m } = await serial(3);
            expect(m.base).toBeLessThan(40);
            expect(m.ms).toBeGreaterThanOrEqual(3 * 40 - 5);
        });
    });
});
