import { describe, it, expect } from 'vitest';
import { sessionMarker, sessionMarkerFromCookie } from '../../../server/lib/session-marker';

function jwtFor(claims: Record<string, unknown>): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'ES256', kid: 'v1' })}.${b64(claims)}.sig`;
}

describe('session marker', () => {
    it('is stable per user, different between users, and does not contain the id', async () => {
        const a = await sessionMarker('user-a');
        expect(a).toBe(await sessionMarker('user-a'));
        expect(a).not.toBe(await sessionMarker('user-b'));
        expect(a).toMatch(/^[0-9a-f]{32}$/);
        expect(a).not.toContain('user-a');
    });

    it('reads the same marker out of the session cookie as the session endpoint computes', async () => {
        const cookie = `theme=dark; __Host-inspector_token=${jwtFor({ sub: 'user-a', exp: 1 })}; other=1`;
        expect(await sessionMarkerFromCookie(cookie)).toBe(await sessionMarker('user-a'));
    });

    it('is null without a readable session', async () => {
        expect(await sessionMarkerFromCookie(undefined)).toBeNull();
        expect(await sessionMarkerFromCookie('a=b')).toBeNull();
        expect(await sessionMarkerFromCookie('__Host-inspector_token=garbage')).toBeNull();
        expect(await sessionMarkerFromCookie(`__Host-inspector_token=${jwtFor({ nosub: true })}`)).toBeNull();
    });
});
