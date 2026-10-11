import type { EmailProvider } from './provider';

/**
 * Longest provider-requested pause the request path will sit through. A person
 * is waiting on the response, so anything longer is reported back instead.
 */
export const MAX_INLINE_RETRY_SECONDS = 2;

export interface RateLimitRetryOptions {
    /** Injected so tests do not wait; defaults to a timer. */
    sleep?: (ms: number) => Promise<void>;
    maxWaitSeconds?: number;
}

const timerSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a provider so a short rate limit is absorbed once, in the request path.
 *
 * When the provider answers `rate_limited` AND told us to wait no longer than
 * `maxWaitSeconds`, sleep that long and send once more. A longer wait, or no
 * hint at all, is returned untouched for the caller to report: guessing a wait
 * would hold the request open for a time the provider never asked for. Only one
 * retry is made, so the worst case is a single short pause.
 *
 * Every other provider member is reachable through the prototype, unchanged.
 */
export function withRateLimitRetry(provider: EmailProvider, opts: RateLimitRetryOptions = {}): EmailProvider {
    const sleep = opts.sleep ?? timerSleep;
    const maxWait = opts.maxWaitSeconds ?? MAX_INLINE_RETRY_SECONDS;
    const sendEmail: EmailProvider['sendEmail'] = async (args) => {
        const first = await provider.sendEmail(args);
        if (first.ok || first.kind !== 'rate_limited') return first;
        const wait = first.retryAfterSeconds;
        if (wait === undefined || wait > maxWait) return first;
        await sleep(wait * 1000);
        return provider.sendEmail(args);
    };
    return Object.assign(Object.create(provider) as EmailProvider, { sendEmail });
}
