/**
 * A flush batch never starts more than N sends in any one-second window.
 * Clock and sleep are injected: the fake sleep advances the fake clock, so the
 * test asserts the schedule without waiting.
 */
import { describe, it, expect } from 'vitest';
import { createSendThrottle } from '../../../server/services/automation/send-throttle';

function fakeClock(start = 1_000_000) {
    let t = start;
    const sleeps: number[] = [];
    return {
        now: () => t,
        sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
        advance: (ms: number) => { t += ms; },
        sleeps,
    };
}

describe('createSendThrottle', () => {
    it('lets a first burst of the limit through with no waiting', async () => {
        const c = fakeClock();
        const th = createSendThrottle({ maxPerSecond: 5, now: c.now, sleep: c.sleep });
        for (let i = 0; i < 5; i++) await th.beforeSend();
        expect(c.sleeps).toEqual([]);
    });

    it('holds the sixth send until a full second after the first', async () => {
        const c = fakeClock();
        const th = createSendThrottle({ maxPerSecond: 5, now: c.now, sleep: c.sleep });
        for (let i = 0; i < 6; i++) await th.beforeSend();
        expect(c.sleeps).toEqual([1000]);
    });

    it('never starts more than the limit inside any one-second window', async () => {
        const c = fakeClock();
        const th = createSendThrottle({ maxPerSecond: 5, now: c.now, sleep: c.sleep });
        const starts: number[] = [];
        for (let i = 0; i < 23; i++) { await th.beforeSend(); starts.push(c.now()); c.advance(10); }
        for (let i = 0; i + 5 < starts.length; i++) {
            expect(starts[i + 5]! - starts[i]!).toBeGreaterThanOrEqual(1000);
        }
    });

    it('does not wait when sends are naturally spread out', async () => {
        const c = fakeClock();
        const th = createSendThrottle({ maxPerSecond: 5, now: c.now, sleep: c.sleep });
        for (let i = 0; i < 12; i++) { await th.beforeSend(); c.advance(400); }
        expect(c.sleeps).toEqual([]);
    });

    it('defaults to five per second', async () => {
        const c = fakeClock();
        const th = createSendThrottle({ now: c.now, sleep: c.sleep });
        for (let i = 0; i < 6; i++) await th.beforeSend();
        expect(c.sleeps).toEqual([1000]);
    });
});
