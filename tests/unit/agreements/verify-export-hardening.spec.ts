/**
 * Edges of the audit export check: erased addresses, a chain that spans a key rotation, the bot-challenge service being unreachable,
 * and the address forms the counters key on. Each refusal sits beside a request that goes through.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { ANONYMIZE_SIGNER_PII, ERASED_SENTINEL } from '../../../server/lib/compliance/anonymize-pii';
import { SigningKeyService } from '../../../server/services/signing-key.service';
import { normalizeAddress } from '../../../server/lib/verify-export-attempts';
import { turnstileKeysMismatched, TURNSTILE_TEST_SITE_KEY } from '../../../server/lib/middleware/bot-protection';
import { createHarness, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';
import { candidatesFor } from '../../../server/lib/verify-export-check';
import { REQUEST_OWN, ENV1, ENV2, ENV3, ENV4, EMAIL1, EMAIL1B, TOKEN, poster, seedEnvelopes, watchDb, withToken } from '../helpers/verify-export-kit';

describe('the audit export check, edges', () => {
    let h: Harness;
    let post: ReturnType<typeof poster>;

    beforeEach(async () => {
        h = await createHarness('standalone');
        await seedEnvelopes(h);
        post = poster(h);
    });
    afterEach(() => { vi.restoreAllMocks(); h.close(); });

    const shape = (r: Response) => JSON.stringify([r.status, [...r.headers.entries()].sort()]);

    describe('erased addresses', () => {
        it('does not accept the erased marker as an email, and still accepts a real email of another signer and the postal code', async () => {
            await h.db.update(schema.agreementSigners).set(ANONYMIZE_SIGNER_PII).where(eq(schema.agreementSigners.id, `${ENV1}-First`));
            await h.db.update(schema.agreementRequests).set({ clientEmail: ERASED_SENTINEL }).where(eq(schema.agreementRequests.id, ENV1));
            const marker = await post(ENV1, withToken({ email: ERASED_SENTINEL }), '192.0.2.1');
            const wrong = await post(ENV1, withToken({ email: 'nobody@example.test' }), '192.0.2.2');
            expect(marker.status).toBe(400);
            expect(wrong.status).toBe(403);
            // The marker with an at-sign in it is not an address either, and is refused like any wrong value.
            const shaped = await post(ENV1, withToken({ email: `${ERASED_SENTINEL}@x.test` }), '192.0.2.3');
            expect(shape(shaped)).toBe(shape(wrong));
            expect(await shaped.text()).toBe(await wrong.text());
            // The marker is not among the candidates at all, so no email can match it.
            const known = await candidatesFor(h.env.DB, ENV1);
            expect(known.emails).not.toContain(ERASED_SENTINEL);
            expect(known.emails).toContain(EMAIL1B);
            // Controls: the other signer's real email goes through.
            expect((await post(ENV1, withToken({ email: EMAIL1B }), '192.0.2.4')).status).toBe(200);
            // On an envelope whose every email was erased there is no email to match, and the postal code is no way in on its own.
            await h.db.update(schema.agreementSigners).set(ANONYMIZE_SIGNER_PII).where(eq(schema.agreementSigners.requestId, ENV3));
            await h.db.update(schema.agreementRequests).set({ clientEmail: ERASED_SENTINEL }).where(eq(schema.agreementRequests.id, ENV3));
            expect((await candidatesFor(h.env.DB, ENV3)).emails).toEqual([]);
            expect((await post(ENV3, withToken({ postalCode: 'K1A 0B1' }), '192.0.2.5')).status).toBe(400);
            expect((await post(ENV3, withToken({ email: 'third.signer@example.test', postalCode: 'K1A 0B1' }), '192.0.2.6')).status).toBe(403);
        });

        it('answers 400 for an email that is not shaped like one, and accepts an ordinary one', async () => {
            for (const email of ['[erased]', 'no-at-sign', 'a@b', 'a b@example.test', '@example.test']) {
                expect((await post(ENV1, withToken({ email }), '192.0.2.7')).status, email).toBe(400);
            }
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.7')).status).toBe(200);
            // An empty email beside a postal code is a request with no email.
            expect((await post(ENV1, withToken({ email: '', postalCode: '78701' }), '192.0.2.7')).status).toBe(400);
        });
    });

    describe('values with nothing left after normalisation', () => {
        it('never match: a stored postal placeholder is not a candidate, and a supplied one is not compared', async () => {
            for (const stored of ['-', '---', ' ', ' - ', '.', '0']) {
                await h.db.update(schema.inspections).set({ addressZip: stored }).where(eq(schema.inspections.id, 'insp-4'));
                // Only the request's own code is left: the placeholder on the inspection is not a candidate.
                expect((await candidatesFor(h.env.DB, ENV4)).postalCodes, JSON.stringify(stored)).toEqual(['60601']);
                for (const supplied of ['-', '--', ' - ', '   ', '.', '0']) {
                    const res = await post(ENV4, withToken({ postalCode: supplied }), '192.0.2.40');
                    expect(res.status, `${JSON.stringify(stored)} vs ${JSON.stringify(supplied)}`).toBe(400);
                }
            }
            // Controls: a real code still works where one is stored, and a placeholder beside a real email does not stop the email.
            expect((await post(ENV1, withToken({ email: EMAIL1, postalCode: '78701' }), '192.0.2.41')).status).toBe(200);
            expect((await post(ENV4, withToken({ email: 'fourth.signer@example.test', postalCode: '-' }), '192.0.2.42')).status).toBe(200);
            // A placeholder stored on the inspection leaves no candidate at all.
            await h.db.update(schema.inspections).set({ addressZip: '-' }).where(eq(schema.inspections.id, 'insp-1'));
            expect((await candidatesFor(h.env.DB, ENV1)).postalCodes).toEqual([]);
        });
    });

    describe('the postal code of the request the inspection came from', () => {
        it('releases the export for a code that matches only the request, and not for a request of another company', async () => {
            // insp-4 has no code of its own: only its request carries one.
            const fourth = 'fourth.signer@example.test';
            expect((await post(ENV4, withToken({ email: fourth, postalCode: '60601' }), '192.0.2.50')).status).toBe(200);
            expect((await post(ENV4, withToken({ email: fourth, postalCode: '60602' }), '192.0.2.51')).status).toBe(403);
            // insp-3 points at a request of another company, whose code must not be used; its own code still works.
            expect((await candidatesFor(h.env.DB, ENV3)).postalCodes).toEqual(['K1A0B1']);
            expect((await post(ENV3, withToken({ email: 'third.signer@example.test', postalCode: '99999' }), '192.0.2.52')).status).toBe(403);
            expect((await post(ENV3, withToken({ email: 'third.signer@example.test', postalCode: 'K1A 0B1' }), '192.0.2.53')).status).toBe(200);
        });

        it('treats a placeholder on the request as no candidate', async () => {
            await h.db.update(schema.inspectionRequests).set({ propertyZip: '-' }).where(eq(schema.inspectionRequests.id, REQUEST_OWN));
            expect((await candidatesFor(h.env.DB, ENV4)).postalCodes).toEqual([]);
            expect((await post(ENV4, withToken({ postalCode: '-' }), '192.0.2.54')).status).toBe(400);
            expect((await post(ENV4, withToken({ email: 'fourth.signer@example.test', postalCode: '60601' }), '192.0.2.55')).status).toBe(403);
        });
    });

    describe('a chain that spans a key rotation', () => {
        it('names every key the chain used in keys[] and in publicKeyPem, and a single-key chain names one', async () => {
            const keys = new SigningKeyService(h.env.DB, 'k'.repeat(32));
            const first = await keys.ensureKeypair(TENANT_ID);
            const rotated = await keys.rotateKeypair(TENANT_ID);
            const seal = (id: string, fingerprint: string) => h.db.update(schema.esignAuditLogs).set({ keyFingerprint: fingerprint }).where(eq(schema.esignAuditLogs.id, id));
            await seal(`${ENV1}-ev0`, first.fingerprint);
            await seal(`${ENV1}-ev1`, first.fingerprint);
            await seal(`${ENV1}-ev2`, rotated.fingerprint);
            const two = JSON.parse(await (await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.10')).text()) as { publicKeyPem: string; keys: Array<{ fingerprint: string; pem: string }> };
            expect(two.keys.map((k) => k.fingerprint).sort()).toEqual([first.fingerprint, rotated.fingerprint].sort());
            expect(two.publicKeyPem.match(/BEGIN PUBLIC KEY/g)).toHaveLength(2);
            for (const k of two.keys) expect(two.publicKeyPem).toContain(k.pem);
            // Control: a chain sealed by one key lists one, and publicKeyPem is that key.
            for (const i of [0, 1, 2]) await seal(`${ENV2}-ev${i}`, first.fingerprint);
            const one = JSON.parse(await (await post(ENV2, withToken({ email: 'other.signer@example.test' }), '192.0.2.11')).text()) as { publicKeyPem: string; keys: Array<{ fingerprint: string; pem: string }> };
            expect(one.keys).toHaveLength(1);
            expect(one.publicKeyPem).toBe(one.keys[0]!.pem);
        });
    });

    describe('the bot-challenge service', () => {
        const stubFetch = (impl: (input: unknown, init?: RequestInit) => Promise<Response>) => {
            const fetchSpy = vi.fn(impl);
            vi.stubGlobal('fetch', fetchSpy);
            return fetchSpy;
        };

        it('answers 503 verification_unavailable, with no write, only when the service cannot be reached; a rejected token stays the uniform 403', async () => {
            const watch = watchDb(h);
            stubFetch(async () => { throw new Error('network down'); });
            const down = await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.20');
            stubFetch(async () => new Response('busy', { status: 503 }));
            const busy = await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.21');
            stubFetch(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
            const rejected = await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.22');
            watch.restore();
            expect(down.status).toBe(503);
            expect(await down.json()).toEqual({ error: 'verification_unavailable' });
            expect(busy.status).toBe(503);
            expect(rejected.status).toBe(403);
            expect(await rejected.json()).toEqual({ error: 'verification_failed' });
            expect(watch.writes()).toEqual([]);
            stubFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.23')).status).toBe(200);
        });

        it('sends the caller address to the service and gives the request a timeout', async () => {
            const spy = stubFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
            await post(ENV1, withToken({ email: EMAIL1 }), '203.0.113.50');
            const init = spy.mock.calls[0]![1] as RequestInit;
            const form = init.body as FormData;
            expect(form.get('remoteip')).toBe('203.0.113.50');
            expect(form.get('response')).toBe(TOKEN);
            expect(init.signal).toBeInstanceOf(AbortSignal);
        });

        it('recognises a real secret paired with the test site key', () => {
            expect(turnstileKeysMismatched({ APP_MODE: 'standalone', TURNSTILE_SECRET_KEY: 'real-secret', TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY })).toBe(true);
            expect(turnstileKeysMismatched({ APP_MODE: 'standalone', TURNSTILE_SECRET_KEY: 'real-secret', TURNSTILE_SITE_KEY: 'real-site' })).toBe(false);
            expect(turnstileKeysMismatched({ APP_MODE: 'saas' })).toBe(false);
            expect(turnstileKeysMismatched({ APP_MODE: 'standalone' })).toBe(false);
        });
    });

    describe('addresses', () => {
        it('counts every spelling of an IPv4 address carried in IPv6 as that IPv4 address, drops zone ids, and keeps the /64 otherwise', () => {
            for (const spelling of ['::ffff:7f00:1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', '0:0:0:0:0:ffff:127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '::FFFF:7F00:1']) {
                expect(normalizeAddress(spelling), spelling).toBe('127.0.0.1');
            }
            expect(normalizeAddress('fe80::1%eth0')).toBe(normalizeAddress('fe80::1'));
            expect(normalizeAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
            expect(normalizeAddress('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
            // Controls: a different prefix is a different network, and a plain IPv4 address is untouched.
            expect(normalizeAddress('64:ff9a::7f00:1')).toBe('64:ff9a:0:0::/64');
            expect(normalizeAddress('203.0.113.7')).toBe('203.0.113.7');
        });

        it('skips the binding limiter when there is no address, so those callers are not pooled under one key', async () => {
            const keys: string[] = [];
            (h.env as unknown as { RATE_LIMITER: unknown }).RATE_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } };
            await post(ENV1, withToken({ email: EMAIL1 }), null);
            expect(keys).toEqual([]);
            // Control: with an address the limiter is asked, for that network.
            await post(ENV1, withToken({ email: EMAIL1 }), '203.0.113.8');
            expect(keys).toEqual(['verify-export:203.0.113.8']);
        });
    });
});
