import { eq } from 'drizzle-orm';
import { automationLogs } from '../../lib/db/schema';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * What the automation ledger does when the email PROVIDER pushes back.
 *
 * Three refusals look alike and want different treatment:
 *
 * - rate limit     — heals in seconds. The row stays PENDING with `send_at`
 *                    moved by the provider's own `retry-after`.
 * - daily quota    — heals at the next UTC midnight. Same shape: PENDING,
 *                    `send_at` moved to that instant.
 * - monthly quota  — does not heal in any useful time. A real failure, with a
 *                    reason a person can act on.
 *
 * The first two reuse the "stay pending and push send_at" mechanism the
 * outbound cooling window already established (./cooling-window): flush() needs
 * no new concept to deliver the row later, and nothing in this repository moves
 * a terminal row back to pending, so spending `failed` on a message that is
 * still owed would lose it for good.
 *
 * A quota refusal whose window the adapter could not name is NOT handled here:
 * it keeps the old terminal behaviour rather than being guessed into a retry.
 */

/** Sentinel the email transport adapter returns so the log writer can tell this
 *  outcome from a fault without carrying the error object across the boundary. */
export const PROVIDER_DEFERRAL_SENTINEL = '__provider_deferral__';

export const RATE_LIMIT_DEFER_REASON =
    'waiting — email provider rate limit, retrying shortly';
export const DAILY_QUOTA_DEFER_REASON =
    'waiting — daily email sending limit reached, retrying after the next UTC midnight';
export const MONTHLY_QUOTA_FAIL_REASON =
    'monthly email sending limit reached at the email provider; this message was not sent';

/** Pause used when the provider rate-limited us without saying for how long. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
/** Floor, so a `retry-after: 0` cannot make the row due again within the same batch. */
const MIN_PAUSE_MS = 1_000;

export type ProviderOutcome =
    | { action: 'defer'; sendAtMs: number; reason: string }
    | { action: 'fail'; reason: string };

/** The start of the UTC day after the one `nowMs` falls in. */
export function nextUtcMidnightMs(nowMs: number): number {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function detailsOf(err: unknown): Record<string, unknown> {
    const d = err instanceof AppError ? err.details : undefined;
    return typeof d === 'object' && d !== null ? d as Record<string, unknown> : {};
}

/**
 * Decide what a provider refusal means for the log row, or null when this is not
 * one of the refusals handled here (so every other error keeps reading as the
 * failure it is).
 */
export function providerOutcomeFor(err: unknown, nowMs: number): ProviderOutcome | null {
    if (!(err instanceof AppError)) return null;
    const details = detailsOf(err);
    if (err.code === ErrorCode.EMAIL_RATE_LIMITED) {
        const secs = details.retryAfterSeconds;
        const pause = typeof secs === 'number' && Number.isFinite(secs)
            ? Math.max(secs * 1000, MIN_PAUSE_MS)
            : DEFAULT_RATE_LIMIT_PAUSE_MS;
        return { action: 'defer', sendAtMs: nowMs + pause, reason: RATE_LIMIT_DEFER_REASON };
    }
    if (err.code === ErrorCode.QUOTA_EXHAUSTED && details.metric === 'email') {
        if (details.quotaWindow === 'daily') {
            return { action: 'defer', sendAtMs: nextUtcMidnightMs(nowMs), reason: DAILY_QUOTA_DEFER_REASON };
        }
        if (details.quotaWindow === 'monthly') return { action: 'fail', reason: MONTHLY_QUOTA_FAIL_REASON };
    }
    return null;
}

/** Write the outcome onto the log row: pending with a later send_at, or failed with the reason. */
export async function applyProviderOutcome(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    logId: string,
    outcome: ProviderOutcome,
): Promise<void> {
    if (outcome.action === 'defer') {
        await db.update(automationLogs)
            .set({ status: 'pending', error: outcome.reason, sendAt: new Date(outcome.sendAtMs) })
            .where(eq(automationLogs.id, logId));
        // NO recipient/PII — the fact and the instant only.
        logger.info('[automation] send deferred after an email provider refusal', { logId, sendAtMs: outcome.sendAtMs });
        return;
    }
    await db.update(automationLogs)
        .set({ status: 'failed', error: outcome.reason })
        .where(eq(automationLogs.id, logId));
    logger.warn('[automation] send failed: provider quota exhausted for the month', { logId });
}
