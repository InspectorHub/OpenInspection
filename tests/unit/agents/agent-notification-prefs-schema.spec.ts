/**
 * The three per-event columns on `users` are RETIRED, and this is the guard
 * against them coming back.
 *
 * They were `is_referral_notification_enabled`, `is_report_notification_enabled`
 * and `is_paid_notification_enabled` — one boolean per event, read by one send
 * method each. That shape is the reason the agent screen and the send path could
 * disagree: adding a fourth agent notification meant adding a fourth column, and
 * the ones nobody added a column for simply had no off switch. Preferences now
 * live in `notification_preferences`, keyed by class and channel, so a new class
 * arrives with its control already working.
 *
 * The failure this pins is not "someone re-adds these exact names" — it is the
 * cheaper mistake of answering the same question in two places, which is
 * invisible until a recipient gets mail they switched off. Enforcement itself is
 * covered by `notifications/preference-enforcement.spec.ts`, and the screen by
 * `notifications/preferences-api.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { users } from '../../../server/lib/db/schema/tenant';

describe('users — retired per-event notification columns', () => {
    it('declares no per-event notification booleans', () => {
        const columns = Object.values(users as unknown as Record<string, { name?: unknown }>)
            .map((c) => (typeof c?.name === 'string' ? c.name : ''))
            .filter(Boolean);

        // A scan that sees nothing would pass this on an empty list, which is
        // the exact way a gate lies about what it checked. Prove it is reading
        // real column names before trusting the absence of the retired ones.
        expect(columns).toContain('email');

        const perEvent = columns.filter((n) => /_notification_enabled$/.test(n));
        expect(perEvent).toEqual([]);
    });
});
