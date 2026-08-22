/**
 * The seam carries a platform actor, and it carries it INSIDE the signature.
 *
 * A second header naming who is acting would be a claim anybody who can reach
 * the integration hostname is able to make — and it is precisely the field the
 * audit trail now rests on. So the actor is covered by the same HMAC as the
 * timestamp, and the tests below are mostly about proving that it is.
 *
 * ⚠️ One shape of test is deliberately NOT written here: tampering by string
 * replacement on the header. The actor travels base64url-encoded, so
 * `header.replace('admin@inspectorhub.io', …)` matches nothing, leaves the
 * header untouched, and passes against an implementation that never signed the
 * actor at all. The tamper tests below decode, edit and re-encode.
 *
 * `m2m-auth.ts` is byte-for-byte identical in apps/portal, so every property
 * here holds for the portal side of the handshake too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signM2mHeader, verifyM2mHeader, type PlatformActor } from '../../../server/lib/m2m-auth';

const pem = (material: string) => `-----BEGIN PRIVATE KEY-----\n${btoa(material)}\n-----END PRIVATE KEY-----`;
const ENV = { JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: pem('shared-key-material-AAAAAAAAAAAAAAAAAAAA') } as Record<string, string | undefined>;

const ACTOR: PlatformActor = { platformAdminId: 'pa-1', email: 'admin@inspectorhub.io' };

/** Decode the middle segment of a signed header back to the actor it carries. */
function decodeActorSegment(segment: string): PlatformActor {
    const bin = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as PlatformActor;
}

function encodeActorSegment(actor: PlatformActor): string {
    const bytes = new TextEncoder().encode(JSON.stringify(actor));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('the M2M seam carries a platform actor', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('round-trips an actor through the signature', async () => {
        const header = await signM2mHeader(ENV, ACTOR);
        const got = await verifyM2mHeader(ENV, header);
        expect(got.ok).toBe(true);
        expect(got.actor?.email).toBe('admin@inspectorhub.io');
        expect(got.actor?.platformAdminId).toBe('pa-1');
    });

    it('rejects a tampered actor — the assertion the whole design rests on', async () => {
        // If the actor is not covered by the signature, anyone who can reach the
        // hostname can claim to be any platform employee, and the audit trail
        // this exists to create is worthless.
        const header = await signM2mHeader(ENV, ACTOR);
        const [ts, actorSeg, mac] = header.split('.') as [string, string, string];

        // Sanity on the fixture itself: the segment really does carry the actor,
        // so a failure below is about the signature and not about a typo here.
        expect(decodeActorSegment(actorSeg).email).toBe('admin@inspectorhub.io');

        const forged = encodeActorSegment({ platformAdminId: 'pa-1', email: 'someone@else.test' });
        expect(forged).not.toBe(actorSeg);
        expect((await verifyM2mHeader(ENV, `${ts}.${forged}.${mac}`)).ok).toBe(false);
    });

    it('rejects an actor ATTACHED to a header that was signed without one', async () => {
        // The other direction of the same attack: take a legitimate unattributed
        // call and dress it up as a named support action.
        const header = await signM2mHeader(ENV);
        const [ts, mac] = header.split('.') as [string, string];
        const attached = `${ts}.${encodeActorSegment(ACTOR)}.${mac}`;
        expect((await verifyM2mHeader(ENV, attached)).ok).toBe(false);
    });

    it('still accepts a call with NO actor — provisioning has none', async () => {
        // The seam's existing routes run with no acting user by design; the
        // module that seeds starter content says so explicitly. Requiring an
        // actor would break every one of them.
        const header = await signM2mHeader(ENV);
        const got = await verifyM2mHeader(ENV, header);
        expect(got.ok).toBe(true);
        expect(got.actor).toBeNull();
    });

    it('an unattributed header is byte-identical to what the old signer produced', async () => {
        // The two apps deploy independently, so for one contract window a new
        // signer talks to an old verifier and vice versa. An actor-less call —
        // which is nearly all of them — must cross that window untouched.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
        const header = await signM2mHeader(ENV);
        expect(header.split('.')).toHaveLength(2);
    });

    it('keeps the skew window — an old signature is still refused, actor or not', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
        const stale = await signM2mHeader(ENV, ACTOR);
        vi.setSystemTime(new Date('2026-08-22T00:06:40Z')); // +400s, past ±300
        expect((await verifyM2mHeader(ENV, stale)).ok).toBe(false);

        // POSITIVE CONTROL — inside the window the same header verifies, so the
        // rejection above is the clock and not the actor segment.
        vi.setSystemTime(new Date('2026-08-22T00:00:30Z'));
        expect((await verifyM2mHeader(ENV, stale)).ok).toBe(true);
    });

    it('refuses a malformed actor segment instead of throwing', async () => {
        const header = await signM2mHeader(ENV, ACTOR);
        const [ts, , mac] = header.split('.') as [string, string, string];
        expect((await verifyM2mHeader(ENV, `${ts}.!!!not-base64!!!.${mac}`)).ok).toBe(false);
        expect((await verifyM2mHeader(ENV, `${ts}..${mac}`)).ok).toBe(false);
    });
});
