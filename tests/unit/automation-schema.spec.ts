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

    it('defaults channel to email and accepts sms', () => {
        const r = CreateAutomationSchema.safeParse(base);
        expect(r.success && r.data.channel).toBe('email');
        expect(CreateAutomationSchema.safeParse({ ...base, channel: 'sms' }).success).toBe(true);
        expect(CreateAutomationSchema.safeParse({ ...base, channel: 'fax' }).success).toBe(false);
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
