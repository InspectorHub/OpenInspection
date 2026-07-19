import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationService } from '../../../server/services/automation.service';

// SP2 — deliverSms now resolves the referenced sms template via the
// TemplateStore (was the embedded smsBody). This metering test drives deliverSms
// with a hand-built stub db, so stub the store to return the sms template body;
// the ctx automation carries an smsTemplateId so resolution is attempted. Keeps
// this suite focused on the metering contract (records once on success, never on
// failure) without a real DB.
vi.mock('../../../server/services/automation/template-store', () => ({
    createOiTemplateStore: () => ({
        resolve: async () => ({ channel: 'sms' as const, body: 'Hi {{client_name}}', variables: [] }),
    }),
}));

// Minimal drizzle-like stub: every chained call returns itself, final terminal
// methods (.get(), .all(), promise-like .then) resolve or return falsy so the
// tenant-config lookup doesn't crash before reaching the send call.
function makeDbStub() {
    const chainable: Record<string, unknown> = {};
    const self = new Proxy(chainable, {
        get(_t, prop) {
            if (prop === 'then') return undefined; // not a real Promise
            if (prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined;
            // Terminal Drizzle methods that need to resolve
            if (prop === 'get') return () => Promise.resolve(null);
            if (prop === 'all') return () => Promise.resolve([]);
            if (prop === 'execute') return () => Promise.resolve([]);
            // run/where/set/from/update/select/insert/values/onConflictDoUpdate — all return self
            return () => self;
        },
    });
    return self as unknown as import('drizzle-orm/d1').DrizzleD1Database;
}

const TENANT_ID = 't1';

// Minimal ctx shapes matching automation.service.ts deliverSms signature.
// Spec 2 Task 0: recipientKind/recipientRoleProfileId replace the old `recipient`
// enum. The default here (role='crp-listing-agent-1', a non-client role profile)
// bypasses the consent gate exactly as the old 'selling_agent' literal did — the
// stub `db` below resolves EVERY `.get()` (including the role-profile lookup) to
// null, so sms.ts's `roleRow?.key === PRIMARY_CLIENT_KEY` check is always false
// regardless of which profile id is passed. That means this generic stub cannot
// exercise the "client role requires granted consent" branch itself (only that
// the non-client bypass still reaches deliverSms/metering unchanged) — the
// consent-required-for-client behavior is covered with a real DB in
// tests/unit/automations/automation-people-sourcing.spec.ts and
// automation-flush-sms.spec.ts.
function makeCtx(recipientKind: 'role' | 'inspector' | 'all' = 'role', recipientRoleProfileId: string | null = 'crp-listing-agent-1') {
    return {
        log: {
            id: 'log-1',
            tenantId: TENANT_ID,
            automationId: 'auto-1',
            inspectionId: 'insp-1',
            recipient: '+15551234567',
            channel: 'sms',
            sendAt: new Date(),
            status: 'pending',
            error: null,
            deliveredAt: null,
            eventId: null,
        },
        automation: {
            id: 'auto-1',
            tenantId: TENANT_ID,
            name: 'Test',
            trigger: 'report.published',
            recipientKind, recipientRoleProfileId,
            delayMinutes: 0,
            subjectTemplate: 'S',
            bodyTemplate: 'B',
            smsBody: 'Hi {{client_name}}',  // no {{review_url}} so no fail-closed gate
            smsTemplateId: 'tpl-sms-1',     // SP2 — deliverSms resolves this via the (mocked) TemplateStore
            channels: '["sms"]',
            channel: 'sms',
            active: true,
            isDefault: false,
            createdAt: new Date(),
            conditions: null,
            serviceIds: null,
            requirePaid: false,
            requireSigned: false,
        },
        inspection: {
            id: 'insp-1',
            tenantId: TENANT_ID,
            propertyAddress: '1 Main St',
            clientName: 'Jane',
            clientEmail: 'jane@example.com',
            clientPhone: '+15551234567',
            clientContactId: null,
            date: '2026-07-01',
            status: 'published',
            paymentStatus: 'paid',
            price: 0,
            agreementRequired: false,
            paymentRequired: false,
            createdAt: new Date(),
        },
        tenant: {
            id: TENANT_ID,
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        },
    };
}

// Fake provider-shaped sms runtime. Uses the new resolveProvider seam —
// the same intent as the old resolveCreds + sendTwilioSms pair:
// assert that on a successful send, metering records exactly once;
// on a failed send, metering is NOT called. Provider identity (Twilio vs
// Telnyx) is irrelevant to the metering logic.
const fakeProviderSendMessage = vi.fn();
const fakeProvider = {
    sendMessage: fakeProviderSendMessage,
    validateInboundSignature: vi.fn().mockResolvedValue(false),
};
const smsMock = {
    resolveProvider: vi.fn().mockResolvedValue({ provider: fakeProvider, from: '+1999' }),
};

describe('SMS metering in deliverSms', () => {
    let svc: AutomationService;
    const record = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        record.mockClear();
        fakeProviderSendMessage.mockClear();
        smsMock.resolveProvider.mockResolvedValue({ provider: fakeProvider, from: '+1999' });
        // 4th constructor arg is metering
        svc = new AutomationService({} as D1Database, undefined, undefined, { record } as any);
    });

    it('records one sms event after a successful provider send', async () => {
        fakeProviderSendMessage.mockResolvedValue({ ok: true });

        const db = makeDbStub();
        const ctx = makeCtx();

        await (svc as any).deliverSms(db, ctx, smsMock, 'Acme', 'acme.example.com');

        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith(TENANT_ID, 'sms', expect.stringMatching(/^\d{4}-\d{2}$/));
    });

    it('does NOT record when the provider send fails', async () => {
        fakeProviderSendMessage.mockResolvedValue({ ok: false, error: 'provider 400: bad' });

        const db = makeDbStub();
        const ctx = makeCtx();

        await (svc as any).deliverSms(db, ctx, smsMock, 'Acme', 'acme.example.com');

        expect(record).not.toHaveBeenCalled();
    });
});
