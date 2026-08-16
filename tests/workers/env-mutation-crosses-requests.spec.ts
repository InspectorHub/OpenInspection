import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

/**
 * Pins the runtime fact that makes `integration-secrets.ts` copy before it
 * writes: **`env` is the same object on every request inside an isolate.**
 *
 * This is the premise, not the protection. `integrationSecretsMiddleware`
 * merges a tenant's DECRYPTED secrets — Resend, Stripe, Twilio, QuickBooks —
 * into `c.env`, and for as long as it did so in place, they stayed there for
 * whoever arrived next. The following tenant inherited them for every key they
 * had not stored themselves, because by then `env` was no longer empty and the
 * env-wins rule resolved to the previous tenant's value.
 *
 * Stripe made that worst. Its DB-wins rule protects a tenant who has their own
 * key; a tenant with none fell through to whatever was left on `env` — the
 * money-misrouting that rule exists to prevent, reached by a different door.
 *
 * Kept because the copy looks redundant to anyone who assumes a fresh env per
 * request. If a future runtime really does hand out a fresh one, this goes red
 * and the copy can be reconsidered — deliberately, with evidence, which is more
 * than the original code had.
 *
 * That the middleware copies is asserted separately and cheaply in
 * `tests/unit/integrations/integration-secrets-no-env-mutation.spec.ts`; this
 * file only establishes why it must.
 */
describe('the runtime reuses one env object per isolate', () => {
    it('shows a write from one request to the next', async () => {
        const first = await SELF.fetch('https://example.com/__probe/env-identity');
        const second = await SELF.fetch('https://example.com/__probe/env-identity');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);

        const a = await first.json<{ sawBefore: string | null }>();
        const b = await second.json<{ sawBefore: string | null }>();

        // A clean start, or the probe is reading state from somewhere else and
        // the second assertion would prove nothing.
        expect(a.sawBefore).toBeNull();

        // The premise. Anything written onto `env` outlives the request.
        expect(b.sawBefore).toBe('written-by-a-previous-request');
    });
});
