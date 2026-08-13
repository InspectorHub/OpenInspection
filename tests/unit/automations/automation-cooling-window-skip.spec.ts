/**
 * Portal #98 item 2 — an automation refused by the cooling window must not
 * spend a terminal status on a clock.
 *
 * A `failed` row says the system broke. It did not. A `skipped` row says we
 * decided not to send — also untrue, and worse in one specific way: nothing in
 * this repository ever moves an automation_log back to `pending`, so a skip
 * here means a company's FIRST report email is never delivered and never
 * retried. The refusal carries the instant it stops applying, so the row is
 * re-scheduled to that instant and stays pending.
 */
import { describe, it, expect, vi } from 'vitest';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import { COOLING_WINDOW_MS } from '../../../server/lib/email/outbound-cooling-window';
import {
    coolingWindowSentinelFor, coolingWindowUnlockAtMs, deferUntilCoolingWindowOpens,
    COOLING_WINDOW_SENTINEL, COOLING_WINDOW_DEFER_REASON,
} from '../../../server/services/automation/cooling-window';

/** `details` passed through verbatim — a default parameter would swallow the
 *  `undefined` case, which is one of the malformed payloads under test. */
const refusalWith = (details: unknown) =>
    new AppError(403, ErrorCode.OUTBOUND_COOLING_WINDOW, 'nope', details);
const refusal = (unlockAtMs: unknown) => refusalWith({ unlockAtMs, windowHours: 24 });

/** Minimal drizzle-shaped recorder: `.update().set().where()`. */
function fakeDb() {
    const set = vi.fn();
    const db = {
        update: vi.fn(() => ({
            set: (v: Record<string, unknown>) => {
                set(v);
                return { where: vi.fn(async () => undefined) };
            },
        })),
    };
    return { db, set };
}

describe('automation delivery — cooling-window refusal', () => {
    it('translates the named refusal into the skip sentinel', () => {
        expect(coolingWindowSentinelFor(refusal(1_000))).toBe(COOLING_WINDOW_SENTINEL);
    });

    it('leaves every other error alone — an outage must still read as an outage', () => {
        expect(coolingWindowSentinelFor(new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'provider down'))).toBeNull();
        expect(coolingWindowSentinelFor(new Error('boom'))).toBeNull();
        expect(coolingWindowSentinelFor(undefined)).toBeNull();
    });

    it('names the reason a human reads, not a code', () => {
        expect(COOLING_WINDOW_DEFER_REASON).toMatch(/new company/i);
    });

    it('reads the unlock instant off the refusal, and only off that refusal', () => {
        expect(coolingWindowUnlockAtMs(refusal(1_770_000_000_000))).toBe(1_770_000_000_000);
        expect(coolingWindowUnlockAtMs(new Error('boom'))).toBeNull();
        expect(coolingWindowUnlockAtMs(new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'down'))).toBeNull();
    });

    it('answers null for a refusal carrying no usable instant — a guess would park the row where nobody looks', () => {
        expect(coolingWindowUnlockAtMs(refusal(undefined))).toBeNull();
        expect(coolingWindowUnlockAtMs(refusal('tomorrow'))).toBeNull();
        expect(coolingWindowUnlockAtMs(refusal(Number.NaN))).toBeNull();
        expect(coolingWindowUnlockAtMs(refusalWith(undefined))).toBeNull();
        expect(coolingWindowUnlockAtMs(refusalWith('not an object'))).toBeNull();
    });

    it('re-schedules to the unlock instant and leaves the row PENDING, so the message is still owed', async () => {
        const { db, set } = fakeDb();
        const now = 1_000_000;
        await deferUntilCoolingWindowOpens(db, 'log-1', now + 3_600_000, now);
        expect(set).toHaveBeenCalledWith({
            status: 'pending',
            error: COOLING_WINDOW_DEFER_REASON,
            sendAt: new Date(now + 3_600_000),
        });
    });

    it('floors an unlock already in the past, so the same refusal cannot re-run every tick forever', async () => {
        const { db, set } = fakeDb();
        const now = 1_000_000;
        await deferUntilCoolingWindowOpens(db, 'log-1', now - 500_000, now);
        expect((set.mock.calls[0][0] as { sendAt: Date }).sendAt.getTime()).toBe(now + 60_000);
    });

    it('caps an unlock beyond the window\'s own length — the policy never asked to hide a report longer', async () => {
        const { db, set } = fakeDb();
        const now = 1_000_000;
        await deferUntilCoolingWindowOpens(db, 'log-1', now + COOLING_WINDOW_MS * 9, now);
        expect((set.mock.calls[0][0] as { sendAt: Date }).sendAt.getTime()).toBe(now + COOLING_WINDOW_MS);
    });

    it('agrees with the Outbox about the exact reason string', async () => {
        // The server WRITES this string; `reasonText` in the browser SWITCHES
        // on it to render "Waiting — …" instead of the "Skipped — {raw}"
        // fallback. The client cannot import the constant (this module reaches
        // D1), so the literal is duplicated — and a duplicated literal drifts
        // silently in exactly the direction that turns a message which is
        // going to arrive back into one that reads as abandoned.
        //
        // Asserted against the SOURCE rather than by importing the module:
        // pulling `communication-view` in drags the compiled paraglide message
        // bundle into a server-side test run, which is both slow and the wrong
        // side of the app/server line this suite sits on.
        const { readFile } = await import('node:fs/promises');
        const src = await readFile(
            new URL('../../../app/lib/communication-view.ts', import.meta.url), 'utf8');
        expect(src).toContain(`case "${COOLING_WINDOW_DEFER_REASON}":`);
    });
});
