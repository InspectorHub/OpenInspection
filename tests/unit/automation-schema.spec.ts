import { describe, it, expect } from 'vitest';
import { CreateAutomationSchema } from '../../server/lib/validations/automation.schema';

describe('CreateAutomationSchema (Track J)', () => {
    const base = {
        name: 'R', trigger: 'report.published', recipient: 'client',
        subjectTemplate: 's', bodyTemplate: 'b',
    };

    it('accepts the new inspection.reminder trigger', () => {
        const r = CreateAutomationSchema.safeParse({ ...base, trigger: 'inspection.reminder' });
        expect(r.success).toBe(true);
    });

    it('defaults channels to email-only and accepts sms with a body (Track L)', () => {
        const r = CreateAutomationSchema.safeParse(base);
        expect(r.success && r.data.channels).toEqual(['email']);
        // sms channel requires a non-empty sms body (superRefine)
        expect(CreateAutomationSchema.safeParse({ ...base, channels: ['email', 'sms'], smsBody: 'hi' }).success).toBe(true);
        expect(CreateAutomationSchema.safeParse({ ...base, channels: ['sms'] }).success).toBe(false);
        // unknown channel value is rejected by the enum
        expect(CreateAutomationSchema.safeParse({ ...base, channels: ['fax'] }).success).toBe(false);
        // empty channels list is rejected (min 1)
        expect(CreateAutomationSchema.safeParse({ ...base, channels: [] }).success).toBe(false);
    });

    it('accepts a conditions object and rejects a malformed one', () => {
        const ok = CreateAutomationSchema.safeParse({
            ...base, conditions: { requirePaid: true, serviceIds: ['s1'] },
        });
        expect(ok.success).toBe(true);
        const bad = CreateAutomationSchema.safeParse({ ...base, conditions: { serviceIds: 'nope' } });
        expect(bad.success).toBe(false);
    });
});
