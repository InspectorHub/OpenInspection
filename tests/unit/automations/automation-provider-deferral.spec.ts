/**
 * What the automation ledger does when the email PROVIDER pushes back.
 *
 * A rate limit and a daily quota both undo themselves on a known clock, so the
 * row must stay pending with its send_at moved (the same shape the cooling
 * window uses) rather than spend a terminal `failed` on a message that is still
 * owed. A monthly quota does not undo itself within any useful time, so that one
 * is a real failure with a reason a person can read.
 */
import { describe, it, expect, vi } from 'vitest';
import { AppError, ErrorCode, Errors } from '../../../server/lib/errors';
import {
    providerOutcomeFor, nextUtcMidnightMs, applyProviderOutcome,
    PROVIDER_DEFERRAL_SENTINEL, RATE_LIMIT_DEFER_REASON, DAILY_QUOTA_DEFER_REASON, MONTHLY_QUOTA_FAIL_REASON,
} from '../../../server/services/automation/provider-deferral';

const quotaError = (quotaWindow?: 'daily' | 'monthly') => new AppError(
    402, ErrorCode.QUOTA_EXHAUSTED, 'quota',
    { metric: 'email', used: 0, cap: 0, billingPortalUrl: null, ...(quotaWindow ? { quotaWindow } : {}) },
);

function fakeDb() {
    const set = vi.fn();
    const db = { update: vi.fn(() => ({ set: (v: Record<string, unknown>) => { set(v); return { where: vi.fn(async () => undefined) }; } })) };
    return { db, set };
}

describe('nextUtcMidnightMs', () => {
    it('is the start of the following UTC day', () => {
        expect(nextUtcMidnightMs(Date.UTC(2026, 9, 11, 13, 45, 12))).toBe(Date.UTC(2026, 9, 12));
    });
    it('moves a full day when called exactly at midnight', () => {
        expect(nextUtcMidnightMs(Date.UTC(2026, 9, 11))).toBe(Date.UTC(2026, 9, 12));
    });
    it('rolls over month and year ends', () => {
        expect(nextUtcMidnightMs(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe(Date.UTC(2027, 0, 1));
    });
});

describe('providerOutcomeFor', () => {
    const now = Date.UTC(2026, 9, 11, 10, 0, 0);

    it('defers a rate limit by the provider retry-after', () => {
        expect(providerOutcomeFor(Errors.EmailRateLimited(30), now))
            .toEqual({ action: 'defer', sendAtMs: now + 30_000, reason: RATE_LIMIT_DEFER_REASON });
    });

    it('falls back to a one-minute pause when the provider gave no hint, never to zero', () => {
        expect(providerOutcomeFor(Errors.EmailRateLimited(), now))
            .toEqual({ action: 'defer', sendAtMs: now + 60_000, reason: RATE_LIMIT_DEFER_REASON });
        expect(providerOutcomeFor(Errors.EmailRateLimited(0), now)).toMatchObject({ sendAtMs: now + 1_000 });
    });

    it('defers a daily quota to the next UTC midnight', () => {
        expect(providerOutcomeFor(quotaError('daily'), now))
            .toEqual({ action: 'defer', sendAtMs: Date.UTC(2026, 9, 12), reason: DAILY_QUOTA_DEFER_REASON });
    });

    it('fails a monthly quota with a readable reason', () => {
        const out = providerOutcomeFor(quotaError('monthly'), now);
        expect(out).toEqual({ action: 'fail', reason: MONTHLY_QUOTA_FAIL_REASON });
        expect(MONTHLY_QUOTA_FAIL_REASON).toMatch(/monthly/i);
    });

    it('leaves a quota of unknown window alone, so it keeps the old terminal behaviour', () => {
        expect(providerOutcomeFor(quotaError(), now)).toBeNull();
    });

    it('leaves a plan quota (no provider window) and every other error alone', () => {
        expect(providerOutcomeFor(Errors.QuotaExhausted({ metric: 'email', used: 100, cap: 100, billingPortalUrl: null }), now)).toBeNull();
        expect(providerOutcomeFor(new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'x'), now)).toBeNull();
        expect(providerOutcomeFor(new Error('boom'), now)).toBeNull();
        expect(providerOutcomeFor(undefined, now)).toBeNull();
    });

    it('ignores a window on a quota error about another metric', () => {
        const e = new AppError(402, ErrorCode.QUOTA_EXHAUSTED, 'q', { metric: 'sms', quotaWindow: 'daily' });
        expect(providerOutcomeFor(e, now)).toBeNull();
    });
});

describe('applyProviderOutcome', () => {
    it('keeps a deferred row PENDING and moves send_at', async () => {
        const { db, set } = fakeDb();
        await applyProviderOutcome(db, 'log-1', { action: 'defer', sendAtMs: 5_000, reason: RATE_LIMIT_DEFER_REASON });
        expect(set).toHaveBeenCalledWith({ status: 'pending', error: RATE_LIMIT_DEFER_REASON, sendAt: new Date(5_000) });
    });

    it('marks a failed row failed with the reason', async () => {
        const { db, set } = fakeDb();
        await applyProviderOutcome(db, 'log-1', { action: 'fail', reason: MONTHLY_QUOTA_FAIL_REASON });
        expect(set).toHaveBeenCalledWith({ status: 'failed', error: MONTHLY_QUOTA_FAIL_REASON });
    });

    it('exposes a sentinel distinct from the cooling-window one', () => {
        expect(PROVIDER_DEFERRAL_SENTINEL).toBe('__provider_deferral__');
    });
});
