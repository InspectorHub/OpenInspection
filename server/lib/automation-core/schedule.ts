// apps/openinspection/server/lib/automation-core/schedule.ts
import type { Clock } from './ports';

/** Non-reminder fast path: a log is due when its stored send_at has passed. */
export function isDueAt(sendAtMs: number, clock: Clock): boolean {
  return sendAtMs <= clock.nowMs();
}

/**
 * Reminder due-time, derived LIVE from the event anchor (e.g. inspection date
 * @09:00 UTC) minus the lead time. Mirrors OI's flush() derivation
 * `inspMs - automation.delayMinutes * 60_000` so a reschedule "just works".
 */
export function reminderDueMs(anchorMs: number, delayMinutes: number): number {
  return anchorMs - delayMinutes * 60_000;
}

/** A reminder is due when its derived due-time has passed (stored send_at ignored). */
export function isReminderDue(anchorMs: number, delayMinutes: number, clock: Clock): boolean {
  return reminderDueMs(anchorMs, delayMinutes) <= clock.nowMs();
}
