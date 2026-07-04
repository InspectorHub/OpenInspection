/**
 * Design System 0520 subsystem D phase 4 task 4.2 — observer HMAC cookie.
 *
 * Round-trips + tampering + expiry + bad-secret cases.
 */
import { describe, it, expect } from 'vitest';
import { signObserverCookie, verifyObserverCookie } from '../../../server/lib/observer-cookie';

const SECRET = 'a'.repeat(32);

describe('observer cookie HMAC (subsystem D P4 T4.2)', () => {
    it('signs and verifies round-trip', async () => {
        const cookie = await signObserverCookie({ linkId: 'l1', inspectionId: 'i1', exp: 9_999_999_999 }, SECRET);
        const out = await verifyObserverCookie(cookie, SECRET);
        expect(out).toEqual({ linkId: 'l1', inspectionId: 'i1', exp: 9_999_999_999 });
    });

    it('rejects tampered payload', async () => {
        const cookie = await signObserverCookie({ linkId: 'l1', inspectionId: 'i1', exp: 9_999_999_999 }, SECRET);
        // Flip a character in the base64 body
        const tampered = cookie.replace(/^./, cookie[0] === 'A' ? 'B' : 'A');
        const out = await verifyObserverCookie(tampered, SECRET);
        expect(out).toBeNull();
    });

    it('rejects expired cookie', async () => {
        const past = Math.floor(Date.now() / 1000) - 100;
        const cookie = await signObserverCookie({ linkId: 'l1', inspectionId: 'i1', exp: past }, SECRET);
        const out = await verifyObserverCookie(cookie, SECRET);
        expect(out).toBeNull();
    });

    it('rejects when secret differs', async () => {
        const cookie = await signObserverCookie({ linkId: 'l1', inspectionId: 'i1', exp: 9_999_999_999 }, SECRET);
        const out = await verifyObserverCookie(cookie, 'b'.repeat(32));
        expect(out).toBeNull();
    });

    it('rejects malformed cookie', async () => {
        expect(await verifyObserverCookie('not.a.cookie', SECRET)).toBeNull();
        expect(await verifyObserverCookie('justaplainstring', SECRET)).toBeNull();
        expect(await verifyObserverCookie('', SECRET)).toBeNull();
    });
});
