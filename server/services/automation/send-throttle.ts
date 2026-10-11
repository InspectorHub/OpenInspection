/**
 * Keeps a flush batch under a provider's request-rate limit.
 *
 * `beforeSend()` resolves immediately while fewer than `maxPerSecond` sends
 * have started in the last second, and otherwise waits until the oldest of
 * them is a full second old. A sliding window, not fixed spacing, so a quiet
 * batch is never slowed and a burst is cut at exactly the limit. The throttle
 * only adds wall-clock time: waiting on a timer costs no CPU.
 *
 * Clock and sleep are injected so tests assert the schedule without waiting.
 */
export interface SendThrottle {
    beforeSend(): Promise<void>;
}

export interface SendThrottleOptions {
    maxPerSecond?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/** Sends per second a flush batch may start. Half of a typical provider limit, to leave room for other senders. */
export const FLUSH_MAX_SENDS_PER_SECOND = 5;

const timerSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createSendThrottle(opts: SendThrottleOptions = {}): SendThrottle {
    const max = Math.max(1, opts.maxPerSecond ?? FLUSH_MAX_SENDS_PER_SECOND);
    const now = opts.now ?? Date.now;
    const sleep = opts.sleep ?? timerSleep;
    const starts: number[] = [];
    return {
        async beforeSend() {
            if (starts.length >= max) {
                const wait = starts[starts.length - max]! + 1000 - now();
                if (wait > 0) await sleep(wait);
            }
            starts.push(now());
            if (starts.length > max) starts.splice(0, starts.length - max);
        },
    };
}
