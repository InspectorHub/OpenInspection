// apps/openinspection/tests/unit/automation-core/schedule.spec.ts
import { describe, it, expect } from 'vitest';
import { isDueAt, reminderDueMs, isReminderDue } from '../../../server/lib/automation-core/schedule';
import type { Clock } from '../../../server/lib/automation-core/ports';

const clockAt = (ms: number): Clock => ({ nowMs: () => ms });

describe('schedule', () => {
  it('isDueAt: send_at <= now → due', () => {
    expect(isDueAt(1000, clockAt(1000))).toBe(true);
    expect(isDueAt(1001, clockAt(1000))).toBe(false);
  });
  it('reminderDueMs = anchor − lead', () => {
    const anchor = Date.parse('2026-07-01T09:00:00Z');
    expect(reminderDueMs(anchor, 1440)).toBe(anchor - 1440 * 60_000);
  });
  it('isReminderDue derives from anchor, ignores any stored send_at', () => {
    const anchor = Date.parse('2026-07-01T09:00:00Z');
    const due = reminderDueMs(anchor, 1440);
    expect(isReminderDue(anchor, 1440, clockAt(due))).toBe(true);
    expect(isReminderDue(anchor, 1440, clockAt(due - 1))).toBe(false);
  });
});
