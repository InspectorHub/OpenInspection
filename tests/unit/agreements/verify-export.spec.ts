/**
 * The signed audit export of an envelope is released after a knowledge check: an email recorded on the envelope, or the postal code of the
 * inspected property. Every case runs through the real application. Each refusal sits beside the request that goes through, so a harness
 * that refuses everything cannot pass.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { createHarness, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';
import { ENV1, ENV2, ENV3, ENV4, EMAIL1, EMAIL1B, CLIENT_EMAIL, EMAIL2, TOKEN, poster, seedEnvelopes, withToken } from '../helpers/verify-export-kit';

describe('the signed audit export knowledge check', () => {
    let h: Harness;
    let post: ReturnType<typeof poster>;

    beforeEach(async () => {
        h = await createHarness('standalone');
        await seedEnvelopes(h);
        post = poster(h);
    });
    afterEach(() => h.close());

    describe('what satisfies the check', () => {
        it('releases the export to the email of any signer, in any case and with spaces around it', async () => {
            for (const email of [EMAIL1, EMAIL1B.toUpperCase(), `  ${EMAIL1}  `, CLIENT_EMAIL]) {
                const res = await post(ENV1, withToken({ email }));
                expect(res.status, email).toBe(200);
            }
        });

        it('answers the same bytes the export always did: the same JSON, the same attachment filename', async () => {
            const res = await post(ENV1, withToken({ email: EMAIL1 }));
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('application/json');
            expect(res.headers.get('content-disposition')).toBe(`attachment; filename="audit-${ENV1.slice(0, 8)}.json"`);
            expect(res.headers.get('cache-control')).toBe('no-store');
            const text = await res.text();
            const body = JSON.parse(text) as { events: unknown[]; exportedAt: string; publicKeyPem: string | null; keyFingerprint: string | null; keys: Array<{ fingerprint: string; pem: string }>; chainValid: boolean };
            const rows = await h.db.select().from(schema.esignAuditLogs).all();
            const mine = rows.filter((r) => r.requestId === ENV1).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            const expected = JSON.stringify({
                envelopeId: ENV1,
                algorithm: 'Ed25519',
                publicKeyPem: body.publicKeyPem,
                keyFingerprint: body.keyFingerprint,
                keys: body.keys,
                events: mine.map((r) => ({
                    id: r.id, event: r.event, createdAt: r.createdAt.toISOString(),
                    payloadJson: r.payloadJson, prevHash: r.prevHash, hash: r.hash, signature: r.signature, keyFingerprint: r.keyFingerprint,
                })),
                chainValid: body.chainValid,
                exportedAt: body.exportedAt,
            }, null, 2);
            expect(text).toBe(expected);
            expect(body.events).toHaveLength(3);
            // The recorded payload is untouched: it still names the signer email the way it was written.
            expect(text).toContain(EMAIL1);
        });

        it('refuses the email of a signer of another envelope, and releases it for that envelope', async () => {
            expect((await post(ENV1, withToken({ email: EMAIL2 }))).status).toBe(403);
            expect((await post(ENV2, withToken({ email: EMAIL2 }))).status).toBe(200);
        });

        it('takes the postal code of the inspected property as a second factor, however it is written, and only beside the right email', async () => {
            for (const postalCode of ['78701', ' 78701 ', '78701-1234', '787011234']) {
                expect((await post(ENV1, withToken({ email: EMAIL1, postalCode }))).status, postalCode).toBe(200);
            }
            for (const postalCode of ['K1A 0B1', 'k1a0b1', 'K1A-0B1']) {
                expect((await post(ENV3, withToken({ email: 'third.signer@example.test', postalCode }))).status, postalCode).toBe(200);
            }
            // A wrong postal code beside the right email refuses: it is an added condition, not a free pass.
            expect((await post(ENV1, withToken({ email: EMAIL1, postalCode: '90210' }))).status).toBe(403);
            expect((await post(ENV3, withToken({ email: 'third.signer@example.test', postalCode: 'K1A 0B2' }))).status).toBe(403);
        });

        it('never releases on a postal code alone, right or wrong, and never on a right postal code beside a wrong email', async () => {
            const alone = await post(ENV1, withToken({ postalCode: '78701' }));
            expect(alone.status).toBe(400);
            expect(await alone.json()).toEqual({ error: 'email_required' });
            expect((await post(ENV1, withToken({ email: 'nobody@example.test', postalCode: '78701' }))).status).toBe(403);
            // Control: the right email with the right postal code goes through.
            expect((await post(ENV1, withToken({ email: EMAIL1, postalCode: '78701' }))).status).toBe(200);
        });

        it('compares the postal code to the request the inspection came from when the inspection has none of its own', async () => {
            expect((await post(ENV4, withToken({ email: 'fourth.signer@example.test', postalCode: '12345' }))).status).toBe(403);
            expect((await post(ENV4, withToken({ email: 'fourth.signer@example.test', postalCode: '60601' }))).status).toBe(200);
            expect((await post(ENV4, withToken({ email: 'fourth.signer@example.test' }))).status).toBe(200);
        });

        it('answers 400 email_required when there is no email, and refuses a body that is not JSON', async () => {
            for (const body of [{}, { email: '   ' }, { postalCode: '78701' }, { email: '', postalCode: '' }, { turnstileToken: TOKEN }, 'not json', 'null']) {
                const res = await post(ENV1, typeof body === 'string' ? body : withToken(body as Record<string, unknown>));
                expect(res.status, JSON.stringify(body)).toBe(400);
                expect(await res.json()).toEqual({ error: 'email_required' });
            }
            expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
        });
    });

    describe('what a refusal says', () => {
        it('is one body for a wrong value, an unknown envelope and missing data, and never echoes what was sent', async () => {
            const wrong = await post(ENV1, withToken({ email: 'wrong.value@example.test' }));
            const unknown = await post('eeeeeeee-0000-4000-8000-00000000ffff', withToken({ email: 'wrong.value@example.test' }));
            const noZip = await post(ENV4, withToken({ email: 'wrong.value@example.test', postalCode: '99999' }));
            const texts = await Promise.all([wrong, unknown, noZip].map((r) => r.text()));
            for (const res of [wrong, unknown, noZip]) expect(res.status).toBe(403);
            expect(new Set(texts).size).toBe(1);
            expect(JSON.parse(texts[0]!)).toEqual({ error: 'verification_failed' });
            expect(texts.join('')).not.toContain('wrong.value');
            expect(texts.join('')).not.toContain('99999');
            // Control: the right value for the same known envelope goes through.
            expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
        });

        it('refuses a request whose bot challenge fails or is missing, and accepts it with a passing challenge', async () => {
            // The deployment enforces the challenge: a request with no token is refused, and the verifier is never asked about it.
            const asked = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
            vi.stubGlobal('fetch', asked);
            expect((await post(ENV1, { email: EMAIL1 })).status).toBe(403);
            expect(asked).not.toHaveBeenCalled();
            // A token the verifier rejects is refused with the same body, after the verifier was asked about exactly that token.
            const failed = await post(ENV1, withToken({ email: EMAIL1 }));
            expect(failed.status).toBe(403);
            expect(await failed.json()).toEqual({ error: 'verification_failed' });
            expect(asked).toHaveBeenCalledTimes(1);
            const sent = ((asked.mock.calls[0] as unknown[])[1] as { body: FormData | string }).body;
            expect(sent instanceof FormData ? String(sent.get('response')) : String(sent)).toContain(TOKEN);
            vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
            expect((await post(ENV1, withToken({ email: EMAIL1 }))).status).toBe(200);
        });

        it('answers every refusal with the same status, content type and headers, whatever was wrong', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
            const failedChallenge = await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.31');
            vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
            const cases = [
                failedChallenge,
                await post(ENV1, withToken({ email: 'wrong.value@example.test' }), '192.0.2.32'),
                await post('eeeeeeee-0000-4000-8000-00000000ffff', withToken({ email: 'wrong.value@example.test' }), '192.0.2.33'),
                await post(ENV4, withToken({ email: 'wrong.value@example.test', postalCode: '99999' }), '192.0.2.34'),
                await post('not a valid envelope id because it is far too long '.repeat(3), withToken({ email: 'wrong.value@example.test' }), '192.0.2.35'),
            ];
            const shape = (r: Response) => JSON.stringify([r.status, [...r.headers.entries()].sort()]);
            for (const r of cases) {
                expect(r.status).toBe(403);
                expect(r.headers.get('content-type')).toContain('application/json');
            }
            expect(new Set(cases.map(shape)).size).toBe(1);
            // Control: a request that goes through differs from the refusals, by status and by the attachment header.
            const ok = await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.36');
            expect(ok.status).toBe(200);
            expect(shape(ok)).not.toBe(shape(cases[0]!));
        });

        it('answers 400 with no payload for a body whose fields are not plain strings of a sane length, and 200 for the plain form', async () => {
            const bad: unknown[] = [
                { email: [EMAIL1] }, { email: { value: EMAIL1 } }, { email: 12345 }, { email: `${'a'.repeat(250)}@example.test` },
                { postalCode: ['78701'] }, { postalCode: { value: '78701' } }, { postalCode: 78701 }, { postalCode: '1'.repeat(21) },
            ];
            for (const body of bad) {
                const res = await post(ENV1, withToken(body as Record<string, unknown>), '192.0.2.40');
                const text = await res.text();
                expect(res.status, JSON.stringify(body)).toBe(400);
                expect(text).not.toContain('events');
            }
            expect((await post(ENV1, withToken({ email: EMAIL1 }), '192.0.2.40')).status).toBe(200);
        });

        it('reads each field on its own: a malformed one counts as not supplied, and without a valid email there is nothing to check', async () => {
            // A malformed email, even beside a right postal code, leaves no email: 400, and the postal code is no way in.
            expect((await post(ENV1, withToken({ email: 'not-an-email', postalCode: '78701' }), '192.0.2.60')).status).toBe(400);
            expect((await post(ENV1, withToken({ email: 'not-an-email' }), '192.0.2.61')).status).toBe(400);
            // A right email beside a malformed postal code: the malformed field is not supplied, so the email carries it.
            expect((await post(ENV1, withToken({ email: EMAIL1, postalCode: ['78701'] }), '192.0.2.62')).status).toBe(200);
            expect((await post(ENV1, withToken({ postalCode: ['78701'] }), '192.0.2.63')).status).toBe(400);
            // A malformed field is never echoed, and a wrong right-shaped value is still the uniform refusal.
            const bad = await post(ENV1, withToken({ email: 'wrong@example.test', postalCode: ['x'] }), '192.0.2.64');
            expect(bad.status).toBe(403);
            expect(await bad.text()).not.toContain('wrong@example.test');
        });

        it('counts the email of a signer who declined as a recorded email, because the signed events record it', async () => {
            await h.db.insert(schema.agreementSigners).values({
                id: 'declined-1', tenantId: TENANT_ID, requestId: ENV1, name: 'Declined', email: 'declined.signer@example.test', role: 'client', status: 'declined', createdAt: new Date(),
            } as never);
            expect((await post(ENV1, withToken({ email: 'declined.signer@example.test' }))).status).toBe(200);
            // Control: the same address is not recorded on another envelope.
            expect((await post(ENV2, withToken({ email: 'declined.signer@example.test' }))).status).toBe(403);
        });
    });

    describe('the old route and the public result', () => {
        it('answers the old GET route with verification_required and no event data', async () => {
            const res = await app.request(`/api/public/verify/${ENV1}/audit-trail`, {}, h.env, makeExecutionContext({ label: 'verify-export' }).ctx);
            expect(res.status).toBe(403);
            const text = await res.text();
            expect(JSON.parse(text)).toEqual({ error: 'verification_required' });
            for (const secret of [EMAIL1, 'hash-0', 'sig-0', 'payloadJson', 'events']) expect(text).not.toContain(secret);
        });

        it('returns no event data on HEAD or with a trailing slash on the old path', async () => {
            for (const [method, path] of [['HEAD', `/api/public/verify/${ENV1}/audit-trail`], ['HEAD', `/api/public/verify/${ENV1}/audit-trail/`], ['GET', `/api/public/verify/${ENV1}/audit-trail/`]] as const) {
                const res = await app.request(path, { method }, h.env, makeExecutionContext({ label: 'verify-export' }).ctx);
                const text = await res.text();
                expect(res.status, `${method} ${path}`).not.toBe(200);
                for (const secret of [EMAIL1, 'hash-0', 'sig-0', 'payloadJson', '"events"']) expect(text).not.toContain(secret);
                expect(res.headers.get('content-disposition')).toBeNull();
            }
            // Control: the plain GET answers verification_required.
            const plain = await app.request(`/api/public/verify/${ENV1}/audit-trail`, {}, h.env, makeExecutionContext({ label: 'verify-export' }).ctx);
            expect(await plain.json()).toEqual({ error: 'verification_required' });
        });

        it('keeps the online verification result public and email-free, and names the site key the form needs', async () => {
            const res = await app.request(`/api/public/verify/${ENV1}`, {}, h.env, makeExecutionContext({ label: 'verify-export' }).ctx);
            expect(res.status).toBe(200);
            const text = await res.text();
            const body = JSON.parse(text) as { data: { signers: unknown[]; turnstileSiteKey: string | null; eventCount: number } };
            expect(body.data.signers).toHaveLength(2);
            expect(body.data.eventCount).toBe(3);
            expect(typeof body.data.turnstileSiteKey).toBe('string');
            for (const email of [EMAIL1, EMAIL1B, CLIENT_EMAIL]) expect(text).not.toContain(email);
        });
    });
});
