import { eq } from 'drizzle-orm';
import { automationLogs } from '../../lib/db/schema';
import { AppError, ErrorCode } from '../../lib/errors';
import { COOLING_WINDOW_MS } from '../../lib/email/outbound-cooling-window';
import { logger } from '../../lib/logger';

/**
 * What the automation ledger does with the ONE refusal that undoes itself.
 *
 * Portal #98 §3.2 declines platform-funded client email for a company's first
 * 24 hours. Every other refusal the send boundary raises is a state of the
 * world that will still be true on the next tick — a dead provider, a bad key,
 * an exhausted plan. This one carries the exact instant it stops being true.
 *
 * So the ledger should not spend a terminal status on it. `failed` says the
 * system broke; `skipped` says we decided not to send. Neither is what
 * happened: the message is still owed, and the only thing standing between it
 * and the recipient is a clock. The row therefore stays PENDING with its
 * `send_at` moved to the unlock instant — the same shape a delayed rule has
 * always had, so flush() needs no new concept to deliver it, and the Outbox's
 * existing "not yet due, so not yet shown" rule applies unchanged.
 *
 * WHY THIS MATTERS MORE FOR REPORTS THAN FOR ANYTHING ELSE. A company signs up
 * and publishes their first report the same afternoon — that is the ordinary
 * first day, not an edge case. Under a terminal status, that first report is
 * never delivered and nothing ever retries it: nothing in this repository
 * moves an automation_log back to `pending`.
 */

/** Sentinel the email transport adapter returns so the log writer can tell this
 *  refusal from a fault without carrying the error object across the boundary. */
export const COOLING_WINDOW_SENTINEL = '__outbound_cooling_window__';

/** What an operator reads on the waiting row. Present tense: it has not been
 *  given up on, which is the whole difference from the reason it replaced. */
export const COOLING_WINDOW_DEFER_REASON =
    'waiting — new company, client email unlocks 24h after signup';

/**
 * Recognise the deliberate decline. Everything else — a dead provider, a bad
 * key, a network error — must keep reading as a failure, or the failure column
 * stops meaning anything.
 */
export function coolingWindowSentinelFor(err: unknown): string | null {
    return coolingWindowCode(err) ? COOLING_WINDOW_SENTINEL : null;
}

function coolingWindowCode(err: unknown): boolean {
    const code = err instanceof AppError
        ? err.code
        : (typeof err === 'object' && err !== null && 'code' in err
            ? (err as { code?: unknown }).code
            : undefined);
    return code === ErrorCode.OUTBOUND_COOLING_WINDOW;
}

/**
 * When the window opens, from the refusal's own payload — or null when this is
 * not that refusal, or it arrived without a usable instant.
 *
 * Null on a malformed payload rather than a guessed default: the caller's
 * fallback is the old terminal skip, which loses one message, and a guessed
 * `send_at` could park a row somewhere nobody looks for it.
 */
export function coolingWindowUnlockAtMs(err: unknown): number | null {
    if (!coolingWindowCode(err)) return null;
    const details = err instanceof AppError ? err.details : undefined;
    const raw = typeof details === 'object' && details !== null && 'unlockAtMs' in details
        ? (details as { unlockAtMs?: unknown }).unlockAtMs
        : undefined;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Park the log at the unlock instant, still pending.
 *
 * The instant is clamped, not trusted. Its source is our own error and is
 * `created_at + 24h` by construction, so both bounds are belt-and-braces
 * against a clock that disagrees with itself: an unlock already in the past
 * would re-run the same refusal on the next tick forever, and one beyond the
 * window's own length would hide a report for longer than the policy ever
 * asked for.
 */
export async function deferUntilCoolingWindowOpens(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    logId: string,
    unlockAtMs: number,
    now: number = Date.now(),
): Promise<void> {
    const sendAtMs = Math.min(Math.max(unlockAtMs, now + 60_000), now + COOLING_WINDOW_MS);
    await db.update(automationLogs)
        .set({ status: 'pending', error: COOLING_WINDOW_DEFER_REASON, sendAt: new Date(sendAtMs) })
        .where(eq(automationLogs.id, logId));
    // NO recipient/PII — the fact and the instant only.
    logger.info('[automation] send deferred to the end of the outbound cooling window', {
        logId, sendAtMs,
    });
}
