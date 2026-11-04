/**
 * The attempt allowance of the signed audit export: counters in the database, reserved before the comparison. Every refusal sits beside
 * a request that goes through, so a harness that refuses everything cannot pass.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createHarness, type Harness } from '../helpers/tenant-email-harness';
import { ENV1, ENV2, ENV3, ENV4, EMAIL1, EMAIL2, poster, seedEnvelopes, withToken } from '../helpers/verify-export-kit';

describe('the audit export attempt allowance', () => {
    let h: Harness;
    let post: ReturnType<typeof poster>;

    beforeEach(async () => {
        h = await createHarness('standalone');
        await seedEnvelopes(h);
        post = poster(h);
    });
    afterEach(() => h.close());

    const wrongEmail = (i: number) => withToken({ email: `wrong.${i}@example.test` });

    it('stops an address after five wrong emails: 429 with Retry-After, and a correct answer from that address is refused too', async () => {
        for (let i = 0; i < 5; i += 1) expect((await post(ENV1, wrongEmail(i))).status).toBe(403);
        const locked = await post(ENV1, wrongEmail(5));
        expect(locked.status).toBe(429);
        expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(await locked.json()).toEqual({ error: 'too_many_attempts' });
        const correct = await post(ENV1, withToken({ email: EMAIL1 }));
        expect(correct.status).toBe(429);
        expect(await correct.text()).not.toContain('events');
        // Control: another envelope is not stopped for that address.
        expect((await post(ENV2, withToken({ email: EMAIL2 }))).status).toBe(200);
    });

    it('does not let one address lock the signer out: a correct answer from another address still works', async () => {
        for (let i = 0; i < 6; i += 1) await post(ENV1, wrongEmail(i), '192.0.2.10');
        expect((await post(ENV1, wrongEmail(9), '192.0.2.10')).status).toBe(429);
        expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.99')).status).toBe(200);
    });

    it('gives a postal code a smaller allowance than an email: three wrong ones, and an email from the same address still works', async () => {
        for (let i = 0; i < 3; i += 1) expect((await post(ENV1, withToken({ postalCode: `0000${i}` }))).status).toBe(403);
        expect((await post(ENV1, withToken({ postalCode: '78701' }))).status).toBe(429);
        // Control: the email allowance of that address is separate and untouched.
        expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
        // Control: before the third miss a right postal code goes through.
        expect((await post(ENV3, withToken({ postalCode: '00000' }), '192.0.2.20')).status).toBe(403);
        expect((await post(ENV3, withToken({ postalCode: 'K1A 0B1' }), '192.0.2.20')).status).toBe(200);
    });

    it('bounds guessing from many addresses with an envelope-wide ceiling of fifty attempts an hour', async () => {
        for (let n = 0; n < 10; n += 1) {
            for (let i = 0; i < 5; i += 1) expect((await post(ENV1, wrongEmail(i), `198.51.100.${n + 1}`)).status).toBe(403);
        }
        const over = await post(ENV1, wrongEmail(1), '198.51.100.200');
        expect(over.status).toBe(429);
        const wait = Number(over.headers.get('retry-after'));
        expect(wait).toBeGreaterThan(900);
        expect(wait).toBeLessThanOrEqual(3600);
        expect((await post(ENV1, withToken({ email: EMAIL1 }), '198.51.100.201')).status).toBe(429);
        // Control: another envelope is not affected.
        expect((await post(ENV2, withToken({ email: EMAIL2 }), '198.51.100.201')).status).toBe(200);
    });

    it('lets at most the cap of parallel wrong guesses reach the comparison and refuses the rest with 429', async () => {
        const results = await Promise.all(Array.from({ length: 14 }, (_, i) => post(ENV1, wrongEmail(i))));
        const statuses = results.map((r) => r.status);
        expect(statuses.filter((s) => s === 403)).toHaveLength(5);
        expect(statuses.filter((s) => s === 429)).toHaveLength(9);
        // Control: the allowance of that address is used up, and another address starts clean.
        expect((await post(ENV1, wrongEmail(99))).status).toBe(429);
        expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.77')).status).toBe(200);
    });

    it('hands the reservation back on success and on a failed bot challenge, so neither uses up the allowance', async () => {
        for (let i = 0; i < 8; i += 1) expect((await post(ENV2, withToken({ email: EMAIL2 }))).status).toBe(200);
        for (let i = 0; i < 8; i += 1) expect((await post(ENV2, { email: EMAIL2 })).status).toBe(403);
        expect((await post(ENV2, wrongEmail(1))).status).toBe(403);
        const rows = await h.db.select().from(schema.verifyExportAttempts).all();
        expect(rows.find((r) => r.key.startsWith('email:'))?.attempts).toBe(1);
        expect(rows.find((r) => r.key.startsWith('envelope:'))?.attempts).toBe(1);
    });

    it('skips the per-address counters when no address is present, and the envelope-wide one still applies', async () => {
        for (let i = 0; i < 8; i += 1) expect((await post(ENV4, wrongEmail(i), null)).status).toBe(403);
        const keys = (await h.db.select().from(schema.verifyExportAttempts).all()).map((r) => r.key);
        expect(keys).toEqual([`envelope:${ENV4}`]);
        // Control: with an address the sixth wrong email is stopped.
        for (let i = 0; i < 5; i += 1) await post(ENV4, wrongEmail(i), '192.0.2.50');
        expect((await post(ENV4, wrongEmail(6), '192.0.2.50')).status).toBe(429);
    });

    it('refuses with the ordinary 403, never an error, when the counter store fails; and answers normally when it works', async () => {
        const real = h.env.DB;
        h.env.DB = new Proxy(real, {
            get(target, prop) {
                if (prop === 'prepare') {
                    return (query: string) => {
                        if (query.includes('verify_export_attempts')) throw new Error('store down');
                        return target.prepare(query);
                    };
                }
                const value = (target as unknown as Record<string | symbol, unknown>)[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const down = await post(ENV1, withToken({ email: EMAIL1 }));
        expect(down.status).toBe(403);
        expect(await down.json()).toEqual({ error: 'verification_failed' });
        h.env.DB = real;
        expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
    });

    it('opens a window at its first attempt and does not extend it', async () => {
        await post(ENV1, wrongEmail(0));
        const first = (await h.db.select().from(schema.verifyExportAttempts).all()).find((r) => r.key.startsWith('email:'))!;
        await post(ENV1, wrongEmail(1));
        const second = (await h.db.select().from(schema.verifyExportAttempts).all()).find((r) => r.key.startsWith('email:'))!;
        expect(second.attempts).toBe(2);
        expect(second.windowEndsAt.getTime()).toBe(first.windowEndsAt.getTime());
    });

    it('starts a new window once the old one has ended, counting from one again', async () => {
        await post(ENV1, wrongEmail(0));
        await h.db.update(schema.verifyExportAttempts).set({ attempts: 5, windowEndsAt: new Date(Date.now() - 10 * 60_000) });
        expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
        expect((await post(ENV1, wrongEmail(2))).status).toBe(403);
        const email = (await h.db.select().from(schema.verifyExportAttempts).all()).find((r) => r.key.startsWith('email:'))!;
        expect(email.attempts).toBe(1);
        expect(email.windowEndsAt.getTime()).toBeGreaterThan(Date.now());
    });
});
