/**
 * Request-path handling of a provider rate limit.
 *
 * A person is waiting on this send, so a short provider-requested pause is
 * worth absorbing once; a long one is not, and the error must say "try again
 * shortly" instead of the generic delivery failure. The sleep is injected so
 * no test waits.
 */
import { describe, it, expect, vi } from 'vitest';
import { withRateLimitRetry } from '../../../server/lib/email/rate-limit-retry';
import { EmailBaseService } from '../../../server/services/email/base';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import type { EmailProvider } from '../../../server/lib/email/provider';

type Result = Awaited<ReturnType<EmailProvider['sendEmail']>>;
const ARGS = { from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: '<p>hi</p>' };
const limited = (retryAfterSeconds?: number): Result =>
    ({ ok: false, error: 'Too many requests.', kind: 'rate_limited', ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) });
const OK: Result = { ok: true, id: 'e1' };

function providerReturning(...results: Result[]) {
    const sendEmail = vi.fn(async () => results.shift() ?? OK);
    return { sendEmail, provider: { sendEmail } as unknown as EmailProvider };
}

describe('withRateLimitRetry', () => {
    it('waits the provider-requested time once and returns the retry result', async () => {
        const { sendEmail, provider } = providerReturning(limited(2), OK);
        const sleep = vi.fn(async () => undefined);
        const res = await withRateLimitRetry(provider, { sleep }).sendEmail(ARGS);
        expect(res).toEqual(OK);
        expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
        expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it('does not retry when the wait is longer than the cap', async () => {
        const { sendEmail, provider } = providerReturning(limited(3), OK);
        const sleep = vi.fn(async () => undefined);
        const res = await withRateLimitRetry(provider, { sleep }).sendEmail(ARGS);
        expect(res).toMatchObject({ ok: false, kind: 'rate_limited', retryAfterSeconds: 3 });
        expect(sleep).not.toHaveBeenCalled();
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not retry when the provider gave no wait hint', async () => {
        const { sendEmail, provider } = providerReturning(limited(), OK);
        const sleep = vi.fn(async () => undefined);
        await withRateLimitRetry(provider, { sleep }).sendEmail(ARGS);
        expect(sleep).not.toHaveBeenCalled();
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('retries only once, then returns the second failure', async () => {
        const { sendEmail, provider } = providerReturning(limited(1), limited(1), OK);
        const sleep = vi.fn(async () => undefined);
        const res = await withRateLimitRetry(provider, { sleep }).sendEmail(ARGS);
        expect(res).toMatchObject({ ok: false, kind: 'rate_limited' });
        expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it('passes success and other failure kinds straight through without sleeping', async () => {
        const sleep = vi.fn(async () => undefined);
        for (const r of [OK, { ok: false, error: 'x', kind: 'transient' }, { ok: false, error: 'q', kind: 'quota_exceeded', quotaWindow: 'daily' }] as Result[]) {
            const { sendEmail, provider } = providerReturning(r);
            expect(await withRateLimitRetry(provider, { sleep }).sendEmail(ARGS)).toEqual(r);
            expect(sendEmail).toHaveBeenCalledTimes(1);
        }
        expect(sleep).not.toHaveBeenCalled();
    });

    it('leaves the other provider methods reachable', () => {
        const verify = vi.fn(async () => true);
        const wrapped = withRateLimitRetry({ sendEmail: vi.fn(), verifyWebhookSignature: verify } as unknown as EmailProvider);
        expect(wrapped.verifyWebhookSignature).toBe(verify);
    });
});

describe('EmailBaseService.sendEmail when the provider is rate limited', () => {
    const svcWith = (...results: Result[]) => {
        const { sendEmail, provider } = providerReturning(...results);
        return { sendEmail, svc: new EmailBaseService('re_key', 'from@x.com', 'App', undefined, undefined, undefined, provider) };
    };

    it('absorbs one short rate limit and delivers', async () => {
        const { sendEmail, svc } = svcWith(limited(0), OK);
        expect(await svc.sendEmail(['b@y.com'], 's', '<p>x</p>')).toEqual({ delivered: true });
        expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it('answers a clear try-again-shortly error, not the generic 502, when it persists', async () => {
        const { svc } = svcWith(limited(0), limited(0));
        const err = await svc.sendEmail(['b@y.com'], 's', '<p>x</p>').catch((e: unknown) => e) as AppError;
        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(429);
        expect(err.code).toBe(ErrorCode.EMAIL_RATE_LIMITED);
        expect(err.message).toMatch(/try again shortly/i);
    });

    it('does not wait for a long rate limit and still gives the clear error', async () => {
        const { sendEmail, svc } = svcWith(limited(30));
        const err = await svc.sendEmail(['b@y.com'], 's', '<p>x</p>').catch((e: unknown) => e) as AppError;
        expect(err.code).toBe(ErrorCode.EMAIL_RATE_LIMITED);
        expect(err.details).toEqual({ retryAfterSeconds: 30 });
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('keeps the generic 502 for a transient fault', async () => {
        const { svc } = svcWith({ ok: false, error: 'boom', kind: 'transient' });
        const err = await svc.sendEmail(['b@y.com'], 's', '<p>x</p>').catch((e: unknown) => e) as AppError;
        expect(err.status).toBe(502);
    });

    it('names the exhausted quota window on the 402 so a caller can tell daily from monthly', async () => {
        for (const quotaWindow of ['daily', 'monthly'] as const) {
            const { svc } = svcWith({ ok: false, error: 'q', kind: 'quota_exceeded', quotaWindow });
            const err = await svc.sendEmail(['b@y.com'], 's', '<p>x</p>').catch((e: unknown) => e) as AppError;
            expect(err.status).toBe(402);
            expect(err.code).toBe(ErrorCode.QUOTA_EXHAUSTED);
            expect(err.details).toMatchObject({ metric: 'email', quotaWindow });
        }
    });

    it('leaves quotaWindow off the 402 when the adapter could not tell', async () => {
        const { svc } = svcWith({ ok: false, error: 'q', kind: 'quota_exceeded' });
        const err = await svc.sendEmail(['b@y.com'], 's', '<p>x</p>').catch((e: unknown) => e) as AppError;
        expect(err.details).not.toHaveProperty('quotaWindow');
    });
});
