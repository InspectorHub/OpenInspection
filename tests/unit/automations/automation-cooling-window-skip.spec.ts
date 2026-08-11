/**
 * Portal #98 item 2 — an automation refused by the cooling window must land in
 * the log as a SKIP with a named reason, not as a failure.
 *
 * A `failed` row says the system broke. It did not: it declined, on purpose,
 * for a reason that resolves by itself within a day. Filing that as a failure
 * is how an operator learns to ignore the failure column.
 */
import { describe, it, expect } from 'vitest';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import { coolingWindowSentinelFor, COOLING_WINDOW_SENTINEL, COOLING_WINDOW_SKIP_REASON }
    from '../../../server/services/automation/deliver-email';

describe('automation delivery — cooling-window refusal', () => {
    it('translates the named refusal into the skip sentinel', () => {
        const err = new AppError(403, ErrorCode.OUTBOUND_COOLING_WINDOW, 'nope', { unlockAtMs: 1, windowHours: 24 });
        expect(coolingWindowSentinelFor(err)).toBe(COOLING_WINDOW_SENTINEL);
    });

    it('leaves every other error alone — an outage must still read as an outage', () => {
        expect(coolingWindowSentinelFor(new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'provider down'))).toBeNull();
        expect(coolingWindowSentinelFor(new Error('boom'))).toBeNull();
        expect(coolingWindowSentinelFor(undefined)).toBeNull();
    });

    it('names the reason a human reads, not a code', () => {
        expect(COOLING_WINDOW_SKIP_REASON).toMatch(/new company/i);
    });
});
