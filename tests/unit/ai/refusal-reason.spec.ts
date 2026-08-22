import { describe, it, expect } from 'vitest';
import {
    AI_REFUSAL_REASONS,
    AI_REFUSAL_REASON,
    isAiRefusalReason,
} from '../../../server/lib/ai/refusal-reason';
import { Errors, AppError, ErrorCode } from '../../../server/lib/errors';

describe('AI refusal reasons', () => {
    it('names every situation that stops a call, and no more', () => {
        // Closed on purpose. An eighth situation must be added there first, so
        // the client that renders a message for each one fails to compile
        // rather than silently showing the fallback.
        expect([...AI_REFUSAL_REASONS].sort()).toEqual([
            'not_configured',
            'over_cap',
            'platform_key_missing',
            'policy_not_accepted',
            'switched_off',
            'unavailable_here',
            'upstream_credential',
        ].sort());
    });

    it('exposes each member as a named constant', () => {
        expect(AI_REFUSAL_REASON.SWITCHED_OFF).toBe('switched_off');
        expect(AI_REFUSAL_REASON.PLATFORM_KEY_MISSING).toBe('platform_key_missing');
    });

    it('maps every constant onto a member of the tuple, with none left over', () => {
        // The POSITIVE control for the guard test below. `isAiRefusalReason`
        // returning false for 'nonsense' proves nothing on its own — a guard
        // hard-wired to `return false` would pass that assertion. Checking the
        // two collections against each other is what makes the vocabulary a
        // fact rather than two lists that happen to be edited together.
        expect(Object.values(AI_REFUSAL_REASON).sort()).toEqual([...AI_REFUSAL_REASONS].sort());
    });

    it('recognises every member and rejects anything else', () => {
        // Positive arm first: every declared member must be recognised, so a
        // guard that refuses everything fails here rather than passing a suite
        // made only of negative assertions.
        for (const reason of AI_REFUSAL_REASONS) {
            expect(isAiRefusalReason(reason)).toBe(true);
        }
        expect(isAiRefusalReason('nonsense')).toBe(false);
        expect(isAiRefusalReason(undefined)).toBe(false);
        expect(isAiRefusalReason(null)).toBe(false);
        // A near-miss, not a random string: the guard must compare the whole
        // value, not merely find one inside another.
        expect(isAiRefusalReason('switched_off ')).toBe(false);
        expect(isAiRefusalReason('SWITCHED_OFF')).toBe(false);
    });
});

describe('Errors.AINotConfigured carries a reason', () => {
    it('keeps the one status and code every AI refusal has always used', () => {
        const err = Errors.AINotConfigured('AI is off.', AI_REFUSAL_REASON.SWITCHED_OFF);
        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(503);
        expect(err.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
    });

    it('carries the same status and code for EVERY reason, not just one', () => {
        // The positive control for the shape claim above. Asserting one reason
        // would not catch a factory that branched on reason and issued a
        // different status for some of them — which is precisely the second
        // failure path this design refuses to grow.
        for (const reason of AI_REFUSAL_REASONS) {
            const err = Errors.AINotConfigured('m', reason);
            expect(err.status).toBe(503);
            expect(err.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
            expect(err.details).toEqual({ reason });
        }
    });

    it('puts the reason in details where a client can read it', () => {
        const err = Errors.AINotConfigured('AI is off.', AI_REFUSAL_REASON.SWITCHED_OFF);
        expect(err.details).toEqual({ reason: 'switched_off' });
    });

    it('leaves details undefined when no reason is given', () => {
        // Every existing call site passes no reason and must keep working.
        expect(Errors.AINotConfigured('anything').details).toBeUndefined();
    });

    it('keeps the message the caller passed, untouched by the reason', () => {
        // The reason picks a message downstream; it must not BECOME one here,
        // or the verbatim provider-rejection sentence would stop being verbatim.
        expect(Errors.AINotConfigured('exact words', AI_REFUSAL_REASON.OVER_CAP).message)
            .toBe('exact words');
    });
});
