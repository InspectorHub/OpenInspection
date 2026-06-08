import { describe, it, expect } from 'vitest';
import { CreateAutomationSchema, UpdateAutomationSchema } from '../../server/lib/validations/automation.schema';

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

    it('parses without channels and defaults to email-only (Track L)', () => {
        const r = CreateAutomationSchema.parse(base);
        expect(r.channels).toEqual(['email']);
    });
});

describe('UpdateAutomationSchema (Track L — partial-update channel-drop regression)', () => {
    it('omitting channels leaves the key ABSENT (no default injection)', () => {
        // Regression: Zod `.partial()` over a field carrying `.default()` would still inject
        // `channels: ['email']`, and the service gates on `'channels' in data` — silently
        // dropping a tenant's enabled SMS channel on any partial PATCH that omits it.
        const r = UpdateAutomationSchema.parse({ active: false });
        expect('channels' in r).toBe(false);
        // delayMinutes carried the same `.default()`-on-`.partial()` injection hazard.
        expect('delayMinutes' in r).toBe(false);
        expect(r).toEqual({ active: false });
    });

    it('explicit channels are kept and round-trip', () => {
        const r = UpdateAutomationSchema.parse({ channels: ['email', 'sms'], smsBody: 'x' });
        expect('channels' in r).toBe(true);
        expect(r.channels).toEqual(['email', 'sms']);
        expect(r.smsBody).toBe('x');
    });

    it('still enforces sms-requires-body and min-1 on update', () => {
        expect(UpdateAutomationSchema.safeParse({ channels: ['sms'] }).success).toBe(false);
        expect(UpdateAutomationSchema.safeParse({ channels: [] }).success).toBe(false);
    });
});
