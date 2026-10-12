/**
 * Stepwise email connection test: every branch of the pure step runner, driven
 * by a fake `fetch`. No network, no real keys.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runEmailStep, type EmailStepDeps, type LastSend } from '../../../server/lib/integration/email-test-steps';
import { runStripeStep, type StripeStepDeps } from '../../../server/lib/integration/stripe-test-steps';

afterEach(() => { vi.unstubAllGlobals(); });

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

interface Net {
    probe?: () => Response | Promise<Response>;
    domains?: () => Response | Promise<Response>;
    send?: () => Response | Promise<Response>;
}
/** Route the fake fetch by URL + method; the send path and the key probe share POST /emails. */
function stubNet(net: Net) {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), body });
        if (String(url).endsWith('/domains')) return (net.domains ?? (() => json({ data: [] }, 200)))();
        // The key probe posts an empty body; a real send carries recipients.
        return body && Object.keys(body).length > 0
            ? (net.send ?? (() => json({ id: 'msg_1' }, 200)))()
            : (net.probe ?? (() => json({}, 422)))();
    }));
    return calls;
}
const down = () => { throw new TypeError('fetch failed'); };

function deps(over: Partial<EmailStepDeps> = {}): EmailStepDeps & { saved: LastSend[]; cleared: { count: number } } {
    const saved: LastSend[] = [];
    const cleared = { count: 0 };
    return {
        apiKey: 're_fake',
        senderEmail: 'hello@mail.example.com',
        senderDisplayName: 'Example Inspections',
        replyTo: 'owner@example.com',
        sessionEmail: 'me@example.com',
        lastSend: null,
        saveLastSend: async (s) => { saved.push(s); },
        clearLastSend: async () => { cleared.count += 1; },
        lookupDelivery: async () => 'none',
        ...over,
        saved,
        cleared,
    };
}
const verifiedDomain = () => json({ data: [{ name: 'mail.example.com', status: 'verified' }] }, 200);

describe('key_valid', () => {
    it('fails as unreachable on a network failure, never as a pass', async () => {
        stubNet({ probe: down, domains: down });
        const r = await runEmailStep('key_valid', deps());
        expect(r.status).toBe('fail');
        expect(r.detail).toMatch(/could not reach/i);
    });
    it('fails on 401', async () => {
        stubNet({ probe: () => json({}, 401) });
        const r = await runEmailStep('key_valid', deps());
        expect(r).toMatchObject({ step: 'key_valid', status: 'fail' });
        expect(r.detail).toMatch(/rejected/i);
    });
    it('passes when Resend answers 422 to the empty probe', async () => {
        stubNet({});
        expect((await runEmailStep('key_valid', deps())).status).toBe('pass');
    });
});

describe('key_scope', () => {
    it('reports a send-only key as a pass that points at the send test', async () => {
        stubNet({ domains: () => json({ name: 'restricted_api_key', message: 'x' }, 401) });
        const r = await runEmailStep('key_scope', deps());
        expect(r.status).toBe('pass');
        expect(r.detail).toMatch(/send-only/i);
    });
    it('reports a full-access key', async () => {
        stubNet({ domains: verifiedDomain });
        expect((await runEmailStep('key_scope', deps())).detail).toMatch(/full-access/i);
    });
    it('is skipped, not run, when the key was rejected', async () => {
        const calls = stubNet({ probe: () => json({}, 403) });
        const r = await runEmailStep('key_scope', deps());
        expect(r.status).toBe('skipped');
        expect(calls.some((c) => c.url.endsWith('/domains'))).toBe(false);
    });
});

describe('sender_domain_verified', () => {
    it('passes for a verified sender domain', async () => {
        stubNet({ domains: verifiedDomain });
        expect(await runEmailStep('sender_domain_verified', deps())).toMatchObject({ status: 'pass' });
    });
    it('fails for an unverified domain and names its status', async () => {
        stubNet({ domains: () => json({ data: [{ name: 'mail.example.com', status: 'pending' }] }, 200) });
        const r = await runEmailStep('sender_domain_verified', deps());
        expect(r.status).toBe('fail');
        expect(r.detail).toContain('pending');
    });
    it('fails when the domain is not on the account (a verified OTHER domain does not count)', async () => {
        stubNet({ domains: () => json({ data: [{ name: 'other.com', status: 'verified' }] }, 200) });
        const r = await runEmailStep('sender_domain_verified', deps());
        expect(r.status).toBe('fail');
        expect(r.detail).toMatch(/not a domain on this/i);
    });
    it('is skipped (not failed) for a send-only key', async () => {
        stubNet({ domains: () => json({ name: 'restricted_api_key' }, 401) });
        expect((await runEmailStep('sender_domain_verified', deps())).status).toBe('skipped');
    });
    it('fails when no sender is saved', async () => {
        stubNet({ domains: verifiedDomain });
        expect((await runEmailStep('sender_domain_verified', deps({ senderEmail: null }))).status).toBe('fail');
    });
});

describe('send_test', () => {
    it('sends once to the session address with the saved sender and Reply-To, and stores the message id', async () => {
        const calls = stubNet({
            domains: verifiedDomain,
            send: () => json({ id: 'msg_42' }, 200, { 'x-resend-daily-quota': '3', 'x-resend-monthly-quota': '40' }),
        });
        const d = deps();
        const r = await runEmailStep('send_test', d);
        expect(r.status).toBe('pass');
        const sent = calls.filter((c) => c.url.endsWith('/emails') && c.body && Object.keys(c.body as object).length > 0);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.body).toMatchObject({
            from: 'Example Inspections <hello@mail.example.com>', to: 'me@example.com', reply_to: 'owner@example.com',
        });
        expect(d.saved).toEqual([{ messageId: 'msg_42', usage: { dailyUsed: 3, monthlyUsed: 40 } }]);
    });
    it('proceeds with a send-only key (the domain step was merely skipped)', async () => {
        stubNet({ domains: () => json({ name: 'restricted_api_key' }, 401) });
        expect((await runEmailStep('send_test', deps())).status).toBe('pass');
    });
    it('forgets the previous test send before sending, so a failed new send leaves nothing to report on', async () => {
        stubNet({ domains: verifiedDomain, send: () => json({ name: 'validation_error', message: 'x' }, 403) });
        const d = deps({ lastSend: { messageId: 'old' } });
        const r = await runEmailStep('send_test', d);
        expect(r.status).toBe('fail');
        expect(d.cleared.count).toBe(1);
        expect(d.saved).toEqual([]);
    });
    it('refuses a saved sender address containing a line break', async () => {
        const calls = stubNet({ domains: verifiedDomain });
        const r = await runEmailStep('send_test', deps({ senderEmail: 'a@mail.example.com\r\nBcc: x@y.z' }));
        expect(r.status).not.toBe('pass');
        expect(calls.some((c) => (c.body as object | null) && Object.keys(c.body as object).length > 0)).toBe(false);
    });
    it('retries once when Resend answers 429 to the key probe', async () => {
        let n = 0;
        stubNet({ probe: () => (++n === 1 ? json({}, 429, { 'retry-after': '1' }) : json({}, 422)) });
        const r = await runEmailStep('key_valid', deps());
        expect(r.status).toBe('pass');
        expect(n).toBe(2);
    });
    it('does not call the key accepted when Resend is still rate limiting on the retry', async () => {
        stubNet({ probe: () => json({}, 429, { 'retry-after': '1' }) });
        const r = await runEmailStep('key_valid', deps());
        expect(r.status).toBe('fail');
        expect(r.detail).toMatch(/rate limiting/i);
    });
    it('does not send when the domain step failed', async () => {
        const calls = stubNet({ domains: () => json({ data: [] }, 200) });
        const r = await runEmailStep('send_test', deps());
        expect(r.status).toBe('skipped');
        expect(calls.some((c) => (c.body as object | null) && Object.keys(c.body as object).length > 0)).toBe(false);
    });
    it('fails on a 429 rate limit with a retry hint', async () => {
        stubNet({ domains: verifiedDomain, send: () => json({ name: 'rate_limit_exceeded', message: 'slow down' }, 429, { 'retry-after': '2' }) });
        const r = await runEmailStep('send_test', deps());
        expect(r.status).toBe('fail');
        expect(r.detail).toMatch(/rate limit/i);
    });
    it('fails on an exhausted quota (429 daily_quota_exceeded)', async () => {
        stubNet({ domains: verifiedDomain, send: () => json({ name: 'daily_quota_exceeded', message: 'no' }, 429) });
        expect((await runEmailStep('send_test', deps())).detail).toMatch(/daily quota/i);
    });
    it('fails when Resend refuses the sender domain (403 validation_error)', async () => {
        stubNet({ domains: verifiedDomain, send: () => json({ name: 'validation_error', message: 'domain not verified' }, 403) });
        expect((await runEmailStep('send_test', deps())).detail).toMatch(/sender address/i);
    });
    it('fails when there is no session address, without calling the send endpoint', async () => {
        const calls = stubNet({ domains: verifiedDomain });
        const r = await runEmailStep('send_test', deps({ sessionEmail: null }));
        expect(r.status).toBe('fail');
        expect(calls.some((c) => (c.body as object | null) && Object.keys(c.body as object).length > 0)).toBe(false);
    });
    it('never puts the API key or provider message in detail', async () => {
        stubNet({ domains: verifiedDomain, send: () => json({ name: 'validation_error', message: 'secret-provider-text re_fake' }, 403) });
        const r = await runEmailStep('send_test', deps());
        expect(r.detail).not.toContain('re_fake');
        expect(r.detail).not.toContain('secret-provider-text');
    });
});

describe('delivery and quota (read what send_test stored; no network)', () => {
    it('are skipped before any test email was sent', async () => {
        const calls = stubNet({});
        expect((await runEmailStep('delivery', deps())).status).toBe('skipped');
        expect((await runEmailStep('quota', deps())).status).toBe('skipped');
        expect(calls).toHaveLength(0);
    });
    it('delivery: delivered passes, bounced fails, nothing yet is pending', async () => {
        const last = { messageId: 'msg_1' };
        expect((await runEmailStep('delivery', deps({ lastSend: last, lookupDelivery: async () => 'delivered' }))).status).toBe('pass');
        expect((await runEmailStep('delivery', deps({ lastSend: last, lookupDelivery: async () => 'bounced' }))).status).toBe('fail');
        expect((await runEmailStep('delivery', deps({ lastSend: last }))).status).toBe('pending');
    });
    it('quota: reads the counters the send carried, else skips', async () => {
        const withUsage = await runEmailStep('quota', deps({ lastSend: { messageId: 'm', usage: { dailyUsed: 3, monthlyUsed: 40 } } }));
        expect(withUsage).toMatchObject({ status: 'pass', detail: '3 sent today, 40 sent this month.' });
        expect((await runEmailStep('quota', deps({ lastSend: { messageId: 'm' } }))).status).toBe('skipped');
    });
});

describe('stripe steps', () => {
    const acct = { accountName: 'Acme', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };
    const sd = (over: Partial<StripeStepDeps> = {}): StripeStepDeps => ({
        fetchAccount: async () => acct, webhookSecretConfigured: true, readDeliveries: async () => [], ...over,
    });
    it('key_valid: fails with no key and when Stripe rejects it', async () => {
        expect((await runStripeStep('key_valid', sd({ fetchAccount: null }))).status).toBe('fail');
        expect((await runStripeStep('key_valid', sd({ fetchAccount: async () => { throw new Error('401'); } }))).status).toBe('fail');
        expect(await runStripeStep('key_valid', sd())).toMatchObject({ status: 'pass', detail: 'Connected to Acme.' });
    });
    it('key_valid: says which mode the key is in when known', async () => {
        expect((await runStripeStep('key_valid', sd({ fetchAccount: async () => ({ ...acct, livemode: false }) }))).detail).toBe('Connected to Acme (test mode).');
        expect((await runStripeStep('key_valid', sd({ fetchAccount: async () => ({ ...acct, livemode: true }) }))).detail).toBe('Connected to Acme (live mode).');
    });
    it('account_capabilities: names what is missing', async () => {
        const r = await runStripeStep('account_capabilities', sd({ fetchAccount: async () => ({ ...acct, payoutsEnabled: false }) }));
        expect(r.status).toBe('fail');
        expect(r.detail).toContain('payouts are not enabled');
        expect((await runStripeStep('account_capabilities', sd())).status).toBe('pass');
    });
    it('webhook: pass / signature failure / no deliveries / no secret', async () => {
        const ok = { ts: '2026-10-01T00:00:00Z', eventType: 'payment_intent.succeeded', result: 'processed' as const };
        expect((await runStripeStep('webhook', sd({ readDeliveries: async () => [ok] }))).status).toBe('pass');
        const bad = { ...ok, result: 'signature_failed' as const };
        expect((await runStripeStep('webhook', sd({ readDeliveries: async () => [bad] }))).detail).toMatch(/signature/i);
        expect((await runStripeStep('webhook', sd())).status).toBe('skipped');
        expect((await runStripeStep('webhook', sd({ webhookSecretConfigured: false }))).status).toBe('fail');
    });
    it('later steps are skipped when the key failed', async () => {
        expect((await runStripeStep('webhook', sd({ fetchAccount: null }))).status).toBe('skipped');
    });
});
