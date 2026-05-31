import { describe, it, expect } from 'vitest';
import { users } from '../../server/lib/db/schema/tenant';

describe('users — A2 notification prefs schema', () => {
    it('declares notify_on_referral, notify_on_report, notify_on_paid', () => {
        const t = users as unknown as Record<string, { name: string; default?: unknown }>;
        expect(t.notifyOnReferral?.name).toBe('notify_on_referral');
        expect(t.notifyOnReport?.name).toBe('notify_on_report');
        expect(t.notifyOnPaid?.name).toBe('notify_on_paid');
    });
});
