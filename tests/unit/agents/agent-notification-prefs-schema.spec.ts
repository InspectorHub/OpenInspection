import { describe, it, expect } from 'vitest';
import { users } from '../../../server/lib/db/schema/tenant';

describe('users — A2 notification prefs schema', () => {
    it('declares is_referral_notification_enabled, is_report_notification_enabled, is_paid_notification_enabled', () => {
        const t = users as unknown as Record<string, { name: string; default?: unknown }>;
        expect(t.notifyOnReferral?.name).toBe('is_referral_notification_enabled');
        expect(t.notifyOnReport?.name).toBe('is_report_notification_enabled');
        expect(t.notifyOnPaid?.name).toBe('is_paid_notification_enabled');
    });
});
