import { describe, it, expect } from 'vitest';
import { QBOService } from '../../server/services/qbo.service';

/**
 * What the real Workers runtime does with a zero-length HMAC key, and that the
 * QuickBooks webhook verifier never gets there.
 *
 * `verifyWebhookSignature` returns false for an empty verifier token BEFORE the
 * key is imported. The reason is the first test: it records what workerd itself
 * does with an empty raw key. If workerd accepts it, a request signed with an
 * empty key would verify against an unconfigured token without that guard.
 */
describe('zero-length HMAC key in workerd', () => {
    const enc = new TextEncoder();
    const body = '[{"intuitaccountid":"1"}]';

    it('records whether importKey accepts an empty raw key, and what verify says', async () => {
        let imported = false;
        let verified: boolean | null = null;
        try {
            const key = await crypto.subtle.importKey('raw', enc.encode(''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
            imported = true;
            const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
            verified = await crypto.subtle.verify('HMAC', key, sig, enc.encode(body));
        } catch {
            imported = false;
        }
        // Observed on workerd (compat date 2026-04-12): importKey REJECTS a
        // zero-length raw HMAC key, so nothing is signed or verified. Pinned so a
        // runtime that starts accepting one shows up here; the verifier's own
        // empty-token guard (next test) is then what stands between a caller and
        // an unconfigured token.
        expect({ imported, verified }).toEqual({ imported: false, verified: null });
    });

    it('the QuickBooks verifier rejects every signature when no token is configured', async () => {
        const realKey = await crypto.subtle.importKey('raw', enc.encode('x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', realKey, enc.encode(body));
        const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

        const svc = new QBOService({} as D1Database, 'cid', 'csec', '', 'j'.repeat(32), 'sandbox');
        expect(await svc.verifyWebhookSignature(body, b64)).toBe(false);
        expect(await svc.verifyWebhookSignature(body, '')).toBe(false);

        // Control: the same signature verifies when that key IS the configured token.
        const configured = new QBOService({} as D1Database, 'cid', 'csec', 'x', 'j'.repeat(32), 'sandbox');
        expect(await configured.verifyWebhookSignature(body, b64)).toBe(true);
    });
});
