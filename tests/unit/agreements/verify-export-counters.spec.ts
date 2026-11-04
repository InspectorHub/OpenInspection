/**
 * What the audit export writes while it counts attempts: no row for an envelope that does not exist, a bounded number of statements for
 * one that does, no stored address, the order of reservation and comparison, and the behaviour of the counters at their edges.
 *
 * Note on the parallel case in verify-export-attempts.spec.ts: it runs on better-sqlite3, where each statement is atomic, so it proves
 * that parallel requests are handed distinct counts. It does not prove how D1 interleaves statements from different isolates.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { logger } from '../../../server/lib/logger';
import { createHarness, type Harness } from '../helpers/tenant-email-harness';
import { ATTEMPT_LIMITS, addressDigest, envelopeBucket, emailBucket, normalizeAddress, reserveAttempts } from '../../../server/lib/verify-export-attempts';
import { EXECUTORS } from '../../../server/lib/compliance/retention-executors';
import { ENV1, ENV2, EMAIL1, EMAIL2, poster, seedEnvelopes, watchDb, withToken } from '../helpers/verify-export-kit';

describe('the audit export counters', () => {
    let h: Harness;
    let post: ReturnType<typeof poster>;

    beforeEach(async () => {
        h = await createHarness('standalone');
        await seedEnvelopes(h);
        post = poster(h);
    });
    afterEach(() => { vi.restoreAllMocks(); h.close(); });

    const rows = () => h.db.select().from(schema.verifyExportAttempts).all();
    const wrongEmail = (i: number) => withToken({ email: `wrong.${i}@example.test` });
    const shape = (r: Response) => JSON.stringify([r.status, [...r.headers.entries()].sort()]);

    describe('unknown envelopes', () => {
        it('answers the same 403 as a wrong value, and writes nothing', async () => {
            const watch = watchDb(h);
            const unknown = await post('eeeeeeee-0000-4000-8000-00000000ffff', wrongEmail(1), '192.0.2.1');
            expect(watch.writes()).toEqual([]);
            watch.restore();
            const wrong = await post(ENV1, wrongEmail(1), '192.0.2.2');
            expect(unknown.status).toBe(403);
            expect(shape(unknown)).toBe(shape(wrong));
            expect(await unknown.text()).toBe(await wrong.text());
            // Control: the known envelope did write its counters.
            expect((await rows()).length).toBeGreaterThan(0);
        });

        it('writes no row and no statement for a flood of random ids', async () => {
            const watch = watchDb(h);
            for (let i = 0; i < 30; i += 1) {
                const id = `${i.toString(16).padStart(8, '0')}-${'f'.repeat(4)}-4000-8000-${'0'.repeat(11)}${i % 10}`;
                const res = await post(id, { ...wrongEmail(i), postalCode: '00000' }, `198.51.100.${i + 1}`);
                expect(res.status).toBe(403);
            }
            expect(watch.writes()).toEqual([]);
            watch.restore();
            expect(await rows()).toEqual([]);
            // Control: one real request is counted.
            await post(ENV1, wrongEmail(1));
            expect((await rows()).length).toBe(2);
        });
    });

    describe('write cost per request class', () => {
        const challenge = (success: boolean, marks?: string[]) => vi.stubGlobal('fetch', vi.fn(async () => {
            marks?.push('TURNSTILE');
            return new Response(JSON.stringify({ success }), { status: 200 });
        }));

        it('writes nothing for an unknown envelope, a request with no token, a failed token, or a locked-out request', async () => {
            for (let i = 0; i < 5; i += 1) await post(ENV1, wrongEmail(i), '192.0.2.70');
            const watch = watchDb(h);
            expect((await post('eeeeeeee-0000-4000-8000-00000000ffff', wrongEmail(1), '192.0.2.71')).status).toBe(403);
            expect((await post(ENV1, { email: 'x@example.test' }, '192.0.2.72')).status).toBe(403);
            challenge(false);
            expect((await post(ENV1, wrongEmail(1), '192.0.2.73')).status).toBe(403);
            challenge(true);
            const locked = await post(ENV1, wrongEmail(9), '192.0.2.70');
            expect(locked.status).toBe(429);
            expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
            watch.restore();
            expect(watch.writes()).toEqual([]);
            // Control: the same envelope from a free network, with a passing challenge, does write.
            const control = watchDb(h);
            expect((await post(ENV1, wrongEmail(1), '192.0.2.74')).status).toBe(403);
            control.restore();
            expect(control.writes()).toHaveLength(2);
        });

        it('writes 2 for a wrong email, 3 for a wrong postal code and 4 for both, after a passed challenge', async () => {
            const counts: number[] = [];
            for (const [i, body] of [wrongEmail(1), withToken({ postalCode: '00000' }), withToken({ email: 'nobody@example.test', postalCode: '00000' })].entries()) {
                const watch = watchDb(h);
                expect((await post(ENV1, body, `192.0.2.${80 + i}`)).status).toBe(403);
                watch.restore();
                counts.push(watch.writes().length);
            }
            expect(counts).toEqual([2, 3, 4]);
        });

        it('checks the lock with one read-only select, and verifies the challenge before the first write', async () => {
            const marks: string[] = [];
            challenge(true, marks);
            const watch = watchDb(h);
            expect((await post(ENV1, wrongEmail(1), '192.0.2.90')).status).toBe(403);
            watch.restore();
            const selects = watch.log.filter((q) => /^\s*select/i.test(q) && q.includes('verify_export_attempts'));
            expect(selects).toHaveLength(1);
            expect(marks).toEqual(['TURNSTILE']);
            // The verifier's call is recorded in the statement log's own order: take the position of the first write and of the call.
            const ordered = watchDb(h);
            challenge(true, ordered.log);
            await post(ENV1, wrongEmail(2), '192.0.2.91');
            ordered.restore();
            const verified = ordered.log.indexOf('TURNSTILE');
            const firstWrite = ordered.log.findIndex((q) => /^\s*(insert|update|delete)\b/i.test(q));
            expect(verified).toBeGreaterThan(-1);
            expect(firstWrite).toBeGreaterThan(verified);
        });
    });

    describe('the binding limiters', () => {
        const install = (reject: (key: string) => boolean = () => false) => {
            const keys: string[] = [];
            (h.env as unknown as { RATE_LIMITER: unknown }).RATE_LIMITER = {
                limit: async ({ key }: { key: string }) => { keys.push(key); return { success: !reject(key) }; },
            };
            return keys;
        };

        it('keys the binding limiter by the normalised /64 network, and asks nothing else', async () => {
            const keys = install();
            await post(ENV1, wrongEmail(1), '2001:db8:1:2::9');
            await post(ENV1, wrongEmail(2), '2001:db8:1:2:ffff::1');
            await post(ENV1, wrongEmail(3), '203.0.113.7');
            expect(keys).toEqual([
                'verify-export:2001:db8:1:2::/64',
                'verify-export:2001:db8:1:2::/64',
                'verify-export:203.0.113.7',
            ]);
        });

        it('answers 429 before any export statement when either limiter rejects, and goes through when neither does', async () => {
            for (const rejectKey of ['verify-export:']) {
                const keys = install((key) => key.startsWith(rejectKey));
                const watch = watchDb(h);
                const res = await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.95');
                watch.restore();
                expect(res.status, rejectKey).toBe(429);
                expect(keys.length).toBeGreaterThan(0);
                expect(watch.log.some((q) => q.includes('agreement_requests') || q.includes('verify_export_attempts'))).toBe(false);
            }
            install();
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.95')).status).toBe(200);
        });
    });

    describe('what a real envelope writes', () => {
        it('writes two upserts for a wrong email, and at most four statements for a right one (two upserts, two hand-backs)', async () => {
            const wrong = watchDb(h);
            await post(ENV1, wrongEmail(1));
            expect(wrong.writes()).toHaveLength(2);
            wrong.restore();
            const right = watchDb(h);
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.9')).status).toBe(200);
            expect(right.writes().length).toBeLessThanOrEqual(4);
            expect(right.writes().filter((q) => /^\s*insert/i.test(q))).toHaveLength(2);
            right.restore();
        });

        it('never stores an address: keys hold a keyed hash, and addresses in one IPv6 /64 share a counter', async () => {
            await post(ENV1, wrongEmail(1), '203.0.113.7');
            await post(ENV1, wrongEmail(2), '2001:db8:aaaa:bbbb:1:2:3:4');
            const keys = (await rows()).map((r) => r.key);
            for (const key of keys) {
                expect(key).not.toContain('203.0.113.7');
                expect(key).not.toContain('2001');
                expect(key.length).toBeLessThan(120);
            }
            // Six wrong emails spread over five addresses of one /64 are stopped as one network; another /64 is not.
            const addresses = ['2001:db8:cccc:dddd::1', '2001:db8:cccc:dddd::2', '2001:db8:cccc:dddd:ffff::3', '2001:db8:cccc:dddd:0:0:0:4', '2001:db8:cccc:dddd::5', '2001:db8:cccc:dddd::6'];
            const statuses: number[] = [];
            for (const [i, address] of addresses.entries()) statuses.push((await post(ENV2, wrongEmail(i), address)).status);
            expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
            expect((await post(ENV2, withToken({ email: EMAIL2 }), '2001:db8:eeee:dddd::1')).status).toBe(200);
        });

        it('bounds postal guesses for the envelope at ten an hour whatever the address, and an email still works from another address', async () => {
            const statuses: number[] = [];
            for (let i = 0; i < 12; i += 1) statuses.push((await post(ENV1, withToken({ postalCode: `0000${i}` }), `192.0.2.${100 + Math.floor(i / 3)}`)).status);
            expect(statuses.filter((s) => s === 403)).toHaveLength(10);
            expect(statuses.slice(10)).toEqual([429, 429]);
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.200')).status).toBe(200);
            // Control: a postal code from a fresh address is refused by the envelope-wide postal counter, a right one included.
            expect((await post(ENV1, withToken({ postalCode: '78701' }), '192.0.2.201')).status).toBe(429);
        });

        it('counts a request that carries both fields on the email and the postal counters', async () => {
            expect((await post(ENV1, withToken({ email: 'nobody@example.test', postalCode: '00000' }))).status).toBe(403);
            const keys = (await rows()).map((r) => r.key.split(':')[0]).sort();
            expect(keys).toEqual(['email', 'envelope', 'envelope-postal', 'postal']);
            // One right and one wrong is satisfied, and both reservations are handed back.
            expect((await post(ENV1, withToken({ email: EMAIL1, postalCode: '00000' }), '192.0.2.31')).status).toBe(200);
            expect((await post(ENV1, withToken({ email: 'nobody@example.test', postalCode: '78701' }), '192.0.2.32')).status).toBe(200);
            const after = await rows();
            expect(after.find((r) => r.key.startsWith('envelope:'))?.attempts).toBe(1);
            expect(after.find((r) => r.key.startsWith('envelope-postal:'))?.attempts).toBe(1);
        });
    });

    describe('order and store failures', () => {
        it('does not look up signers or read the export while the counter says stop', async () => {
            for (let i = 0; i < 5; i += 1) await post(ENV1, wrongEmail(i));
            const watch = watchDb(h);
            expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(429);
            watch.restore();
            expect(watch.log.some((q) => q.includes('agreement_signers') || q.includes('esign_audit_logs'))).toBe(false);
            // Control: an address that is not stopped does read them.
            const open = watchDb(h);
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.250')).status).toBe(200);
            open.restore();
            expect(open.log.some((q) => q.includes('agreement_signers'))).toBe(true);
        });

        it('reserves before it compares: the first counter statement comes before the first signer lookup', async () => {
            const watch = watchDb(h);
            await post(ENV1, wrongEmail(1));
            watch.restore();
            const reserve = watch.log.findIndex((q) => q.includes('verify_export_attempts'));
            const compare = watch.log.findIndex((q) => q.includes('agreement_signers'));
            expect(reserve).toBeGreaterThan(-1);
            expect(compare).toBeGreaterThan(reserve);
        });

        it('hands the reservation back and answers the uniform 403 when a read after the reservation throws', async () => {
            const logged = vi.spyOn(logger, 'error');
            for (const table of ['agreement_signers', 'esign_audit_logs']) {
                const watch = watchDb(h, table);
                const res = await post(ENV1, withToken({ email: EMAIL1 }), `192.0.2.${table.length}`);
                watch.restore();
                expect(res.status, table).toBe(403);
                expect(await res.json()).toEqual({ error: 'verification_failed' });
            }
            expect(logged).toHaveBeenCalledWith('verify.export.read.failed', {}, expect.any(Error));
            // The caller was not at fault: nothing stays counted, so the same answer goes through afterwards.
            for (const row of await rows()) expect(row.attempts, row.key).toBe(0);
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.200')).status).toBe(200);
        });

        it('refuses with the ordinary 403 and logs a hint when the counter table is missing, and works again once it exists', async () => {
            const logged = vi.spyOn(logger, 'error');
            h.sqlite.exec('DROP TABLE verify_export_attempts');
            const res = await post(ENV1, withToken({ email: EMAIL1 }));
            expect(res.status).toBe(403);
            expect(await res.json()).toEqual({ error: 'verification_failed' });
            expect(logged).toHaveBeenCalledWith('verify.export.attempts.unavailable', expect.objectContaining({ hint: expect.stringContaining('db:migrate') }), expect.any(Error));
            h.sqlite.exec('CREATE TABLE verify_export_attempts (key text PRIMARY KEY NOT NULL, attempts integer NOT NULL, window_ends_at integer NOT NULL)');
            expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
        });
    });

    describe('the counters at their edges', () => {
        const T0 = 1_800_000_000_000;

        it('starts a new window exactly when the old one ends, and not a millisecond before', async () => {
            const bucket = envelopeBucket('edge-1');
            await reserveAttempts(h.env.DB, [bucket], T0);
            const end = T0 + bucket.windowSeconds * 1000;
            expect((await reserveAttempts(h.env.DB, [bucket], end - 1)).waitSeconds).toBe(0);
            expect((await rows()).find((r) => r.key === bucket.key)?.attempts).toBe(2);
            await reserveAttempts(h.env.DB, [bucket], end);
            const row = (await rows()).find((r) => r.key === bucket.key)!;
            expect(row.attempts).toBe(1);
            expect(row.windowEndsAt.getTime()).toBe(end + bucket.windowSeconds * 1000);
        });

        it('stops the request that goes over the limit, with the seconds left in its window', async () => {
            const bucket = { ...envelopeBucket('edge-2'), limit: 2 };
            expect((await reserveAttempts(h.env.DB, [bucket], T0)).waitSeconds).toBe(0);
            expect((await reserveAttempts(h.env.DB, [bucket], T0)).waitSeconds).toBe(0);
            const over = await reserveAttempts(h.env.DB, [bucket], T0 + 1000);
            expect(over.waitSeconds).toBe(bucket.windowSeconds - 1);
            // The refused request handed its own reservation back: the count stays at the limit.
            expect((await rows()).find((r) => r.key === bucket.key)?.attempts).toBe(2);
        });

        it('hands back only the window it counted in: a release after the window rolled over leaves the new count alone', async () => {
            const bucket = emailBucket('edge-3', 'who');
            const first = await reserveAttempts(h.env.DB, [bucket], T0);
            const rolled = T0 + bucket.windowSeconds * 1000 + 5;
            await reserveAttempts(h.env.DB, [bucket], rolled);
            await first.release();
            expect((await rows()).find((r) => r.key === bucket.key)?.attempts).toBe(1);
            // Control: a release in the same window does lower the count.
            const second = await reserveAttempts(h.env.DB, [bucket], rolled + 1);
            expect((await rows()).find((r) => r.key === bucket.key)?.attempts).toBe(2);
            await second.release();
            expect((await rows()).find((r) => r.key === bucket.key)?.attempts).toBe(1);
        });
    });

    describe('addresses', () => {
        it('reduces an IPv6 address to its /64 and leaves IPv4 as it is', () => {
            expect(normalizeAddress('203.0.113.7')).toBe('203.0.113.7');
            expect(normalizeAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
            expect(normalizeAddress('2001:DB8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
            expect(normalizeAddress('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
            expect(normalizeAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
            expect(normalizeAddress('not an address:')).toBe('not an address:');
        });

        it('hashes the network with the deployment secret: stable, keyed, and not the address', async () => {
            const a = await addressDigest('2001:db8:1:2::9', 'secret-one-secret-one-secret-one!');
            expect(a).toBe(await addressDigest('2001:db8:1:2:ffff::1', 'secret-one-secret-one-secret-one!'));
            expect(a).not.toBe(await addressDigest('2001:db8:1:3::9', 'secret-one-secret-one-secret-one!'));
            expect(a).not.toBe(await addressDigest('2001:db8:1:2::9', 'secret-two-secret-two-secret-two!'));
            expect(a).toMatch(/^[0-9a-f]{32}$/);
            await expect(addressDigest('203.0.113.7', undefined)).rejects.toThrow();
        });
    });

    describe('retention', () => {
        it('is swept by the scheduled retention rule: counters whose window ended before the cutoff are deleted, open ones stay', async () => {
            await post(ENV1, wrongEmail(1));
            const all = await rows();
            const ended = all.find((r) => r.key.startsWith('email:'))!;
            await h.db.update(schema.verifyExportAttempts).set({ windowEndsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }).where(eq(schema.verifyExportAttempts.key, ended.key));
            const removed = await EXECUTORS.verify_export_attempts!(h.db as never, new Date(Date.now() - 24 * 60 * 60 * 1000), {} as never);
            expect(removed).toBe(1);
            const left = (await rows()).map((r) => r.key);
            expect(left).not.toContain(ended.key);
            expect(left.length).toBe(all.length - 1);
        });
    });

    describe('the documented numbers', () => {
        it('are the numbers in ATTEMPT_LIMITS: the document names every limit and the per-envelope write figure derived from them', () => {
            const doc = readFileSync(`${process.cwd()}/docs/integrations/turnstile.md`, 'utf8');
            const minutes = (seconds: number) => seconds / 60;
            const { email, postal, envelopePostal, envelope } = ATTEMPT_LIMITS;
            expect(doc).toContain(`${email.limit} wrong emails per ${minutes(email.windowSeconds)} minutes`);
            expect(doc).toContain(`${postal.limit} wrong postal codes per ${minutes(postal.windowSeconds)} minutes`);
            expect(doc).toContain(`${envelopePostal.limit} postal codes per hour`);
            expect(doc).toContain(`${envelope.limit} attempts of either kind per hour`);
            // A caller who knows no answer writes at most four rows per kept attempt, up to the envelope-wide ceiling.
            const perHour = envelope.limit * 4;
            expect(doc).toContain(`about ${perHour} writes an hour (${(perHour * 24).toLocaleString('en-US')} a day)`);
            // Control: the check reads real text, so a different number is not found.
            expect(doc).not.toContain(`${email.limit + 1} wrong emails per`);
        });
    });
});
