import { describe, it, expect } from 'vitest';
import { CreateAutomationSchema, UpdateAutomationSchema, AutomationSchema } from '../../../server/lib/validations/automation.schema';

describe('CreateAutomationSchema (Track J)', () => {
    // SP2: subjectTemplate/bodyTemplate removed; emailTemplateId/smsTemplateId replace them.
    // Spec 2 Task 0: recipientKind + recipientRoleProfileId replace the old `recipient` enum.
    const base = {
        name: 'R', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: 'crp-client-1',
    };

    it('accepts the new inspection.reminder trigger', () => {
        const r = CreateAutomationSchema.safeParse({ ...base, trigger: 'inspection.reminder' });
        expect(r.success).toBe(true);
    });

    it('defaults channels to email-only; sms channel can be used without a body (SP2: delivery fail-closes)', () => {
        const r = CreateAutomationSchema.safeParse(base);
        expect(r.success && r.data.channels).toEqual(['email']);
        // SP2: smsBody is gone — an sms automation no longer requires an inline body.
        // The delivery layer fail-closes when no template is linked.
        expect(CreateAutomationSchema.safeParse({ ...base, channels: ['email', 'sms'] }).success).toBe(true);
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

    it('explicit channels are kept and round-trip; smsTemplateId round-trips (SP2)', () => {
        const r = UpdateAutomationSchema.parse({ channels: ['email', 'sms'], smsTemplateId: 'tpl-x' });
        expect('channels' in r).toBe(true);
        expect(r.channels).toEqual(['email', 'sms']);
        // SP2: smsBody is gone; smsTemplateId round-trips instead.
        expect(r.smsTemplateId).toBe('tpl-x');
    });

    it('min-1 channel constraint still enforced on update', () => {
        // SP2: smsBodyRequiredWhenSms refine is removed; only structural validation remains.
        expect(UpdateAutomationSchema.safeParse({ channels: [] }).success).toBe(false);
        // sms channel without a body is now ALLOWED (delivery fail-closes, no refine).
        expect(UpdateAutomationSchema.safeParse({ channels: ['sms'] }).success).toBe(true);
    });
});

it('SP2: CreateAutomationSchema accepts template ids and no longer requires bodyTemplate', () => {
    const r = CreateAutomationSchema.safeParse({
        name: 'R', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: 'crp-client-1',
        delayMinutes: 0, channels: ['email'], emailTemplateId: 'tpl-1',
    });
    expect(r.success).toBe(true);
});

it('SP2: AutomationSchema exposes emailTemplateId + smsTemplateId', () => {
    const shape = AutomationSchema.shape as Record<string, unknown>;
    expect(shape.emailTemplateId).toBeDefined();
    expect(shape.smsTemplateId).toBeDefined();
});

describe('CreateAutomationSchema recipient discriminator (Spec 2 Task 0)', () => {
    const withRecipient = (overrides: Record<string, unknown>) => CreateAutomationSchema.safeParse({
        name: 'R', trigger: 'report.published', ...overrides,
    });

    it("rejects recipientKind:'role' with no recipientRoleProfileId", () => {
        expect(withRecipient({ recipientKind: 'role' }).success).toBe(false);
        expect(withRecipient({ recipientKind: 'role', recipientRoleProfileId: null }).success).toBe(false);
    });

    it("accepts recipientKind:'role' with a recipientRoleProfileId", () => {
        expect(withRecipient({ recipientKind: 'role', recipientRoleProfileId: 'crp-1' }).success).toBe(true);
    });

    it("rejects recipientKind:'inspector'/'all' carrying a stray recipientRoleProfileId", () => {
        expect(withRecipient({ recipientKind: 'inspector', recipientRoleProfileId: 'crp-1' }).success).toBe(false);
        expect(withRecipient({ recipientKind: 'all', recipientRoleProfileId: 'crp-1' }).success).toBe(false);
    });

    it("accepts recipientKind:'inspector'/'all' with no recipientRoleProfileId", () => {
        expect(withRecipient({ recipientKind: 'inspector' }).success).toBe(true);
        expect(withRecipient({ recipientKind: 'all' }).success).toBe(true);
    });

    it('UpdateAutomationSchema has no refine — a partial PATCH may omit both fields', () => {
        expect(UpdateAutomationSchema.safeParse({ active: false }).success).toBe(true);
    });
});
