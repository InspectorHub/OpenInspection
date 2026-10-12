/**
 * The siteverify wrapper used by the human check: a definite answer is told apart
 * from "could not tell", and the original boolean helper keeps its contract for
 * its other callers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyTurnstile, verifyTurnstileOutcome } from '../../../server/lib/middleware/bot-protection';

afterEach(() => { vi.unstubAllGlobals(); });

const answer = (status: number, body: unknown = { success: true }) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('verifyTurnstileOutcome', () => {
    it('maps the answers: success, rejection, throttling, server error, network error, timeout', async () => {
        vi.stubGlobal('fetch', answer(200, { success: true }));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('yes');
        vi.stubGlobal('fetch', answer(200, { success: false }));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('no');
        vi.stubGlobal('fetch', answer(403));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('no');
        vi.stubGlobal('fetch', answer(429));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('error');
        vi.stubGlobal('fetch', answer(503));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('error');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('error');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }));
        expect(await verifyTurnstileOutcome('t', 's')).toBe('error');
    });

    it('sends the idempotency key so a retry returns the first answer', async () => {
        const f = answer(200);
        vi.stubGlobal('fetch', f);
        await verifyTurnstileOutcome('t', 's', 'key-1');
        const body = (f.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
        expect(body.get('idempotency_key')).toBe('key-1');
        expect(body.get('response')).toBe('t');
    });

    it('still throws on an empty secret, because that is a misconfiguration', async () => {
        await expect(verifyTurnstileOutcome('t', '')).rejects.toThrow(/not configured/);
    });
});

describe('verifyTurnstile (unchanged contract for other callers)', () => {
    it('is true only on success, false on any non-2xx, and throws on an empty secret', async () => {
        vi.stubGlobal('fetch', answer(200, { success: true }));
        expect(await verifyTurnstile('t', 's')).toBe(true);
        vi.stubGlobal('fetch', answer(503));
        expect(await verifyTurnstile('t', 's')).toBe(false);
        await expect(verifyTurnstile('t', '')).rejects.toThrow(/not configured/);
    });
});
