/**
 * Track L (Task 9, Part D) — Settings → Communication SMS section.
 *
 * Same BFF-seam approach as settings-automations.spec.ts: exercise the exported
 * loader/action against a mocked api-client. We assert the loader surfaces the
 * SMS effective source (no secrets) + tenant company phone, and the three SMS
 * intents (save config / save secrets / test send) hit the right BFF endpoints.
 * The rendered section (mode toggle, SecretFields, inbound URL, test button) is
 * Chrome-verified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getComm = vi.fn();
const getSecrets = vi.fn();
const getTemplates = vi.fn();
const getSmsConfig = vi.fn();
const getTenantConfig = vi.fn();
const getSmsCompliance = vi.fn();
const patchTenantConfig = vi.fn();
const putSecrets = vi.fn();
const postSmsTest = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-123'),
}));

// RBAC guard — admins pass; the route's forbidden branch is exercised via E2E.
vi.mock('~/lib/access.server', () => ({
    requireAdminLoader: vi.fn(async () => ({ forbidden: false, token: 'tok-123' })),
}));

vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        admin: {
            communication: { $get: getComm, $patch: vi.fn() },
            'tenant-config': { $get: getTenantConfig, $patch: patchTenantConfig },
        },
        secrets: { secrets: { $get: getSecrets, $put: putSecrets } },
        emailTemplates: { 'email-templates': { $get: getTemplates } },
        smsAdmin: { sms: { config: { $get: getSmsConfig }, test: { $post: postSmsTest }, compliance: { $get: getSmsCompliance } } },
        integrations: { resend: { test: { $post: vi.fn() } } },
    })),
}));

import { loader, action } from '~/routes/settings-communication';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true) {
    return { ok, json: async () => body } as unknown as Response;
}

function loaderArgs(): LoaderArgs {
    return {
        request: new Request('http://app.example.com/settings/communication'),
        context: {} as never,
        params: {},
    } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/communication', { method: 'POST', body: fd }),
        context: {} as never,
        params: {},
    } as unknown as ActionArgs;
}

beforeEach(() => {
    getComm.mockReset().mockResolvedValue(jsonRes({ data: { emailMode: 'platform' } }));
    getSecrets.mockReset().mockResolvedValue(jsonRes({ data: { TWILIO_ACCOUNT_SID: 'AC••••1234' } }));
    getTemplates.mockReset().mockResolvedValue(jsonRes({ data: [] }));
    getSmsConfig.mockReset().mockResolvedValue(jsonRes({ data: { mode: 'own', effectiveSource: 'own' } }));
    getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { smsMode: 'own', companyPhone: '+15551112222' } }));
    getSmsCompliance.mockReset().mockResolvedValue(jsonRes({ data: { mode: 'own', complianceStatus: 'approved', rejectionReason: null, tollfree: [] } }));
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true, data: { ok: true } }));
    putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
    postSmsTest.mockReset().mockResolvedValue(jsonRes({ success: true }));
});

describe('settings-communication loader — SMS config (Part D)', () => {
    it('surfaces the SMS effective source + company phone (no secrets leaked)', async () => {
        const data = await loader(loaderArgs());
        expect(getSmsConfig).toHaveBeenCalled();
        expect(data.smsConfig).toEqual({ mode: 'own', effectiveSource: 'own' });
        expect(data.companyPhone).toBe('+15551112222');
        // Masked secret value passes through (display state), never plaintext.
        expect(data.secrets.TWILIO_ACCOUNT_SID).toBe('AC••••1234');
    });

    it('degrades SMS config to platform/none when the call fails', async () => {
        getSmsConfig.mockResolvedValue(jsonRes(null, false));
        getTenantConfig.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.smsConfig).toEqual({ mode: 'platform', effectiveSource: 'none' });
        expect(data.companyPhone).toBe('');
    });
});

describe('settings-communication loader — SMS compliance status (Task 5)', () => {
    it('surfaces complianceStatus + rejectionReason from the compliance endpoint', async () => {
        const data = await loader(loaderArgs());
        expect(getSmsCompliance).toHaveBeenCalled();
        expect(data.compliance).toEqual({ complianceStatus: 'approved', rejectionReason: null });
    });

    it('degrades compliance to not_started when the compliance call fails', async () => {
        getSmsCompliance.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.compliance).toEqual({ complianceStatus: 'not_started', rejectionReason: null });
    });

    it('passes rejectionReason through when status is rejected', async () => {
        getSmsCompliance.mockResolvedValue(jsonRes({
            data: { mode: 'own', complianceStatus: 'rejected', rejectionReason: 'Website URL does not match business.', tollfree: [] },
        }));
        const data = await loader(loaderArgs());
        expect(data.compliance).toEqual({ complianceStatus: 'rejected', rejectionReason: 'Website URL does not match business.' });
    });
});

describe('settings-communication action — SMS intents (Part D)', () => {
    it('intent=save-sms-config PATCHes tenant-config with smsMode + companyPhone (empty → null)', async () => {
        await action(actionArgs({ intent: 'save-sms-config', smsMode: 'own', companyPhone: '+15553334444' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { smsMode: 'own', companyPhone: '+15553334444' } });
    });

    it('intent=save-sms-config clears companyPhone to null when blank (invalid mode falls back to "own")', async () => {
        // 'platform' is a first-party-only mode rejected by the action; it normalises to 'own'.
        await action(actionArgs({ intent: 'save-sms-config', smsMode: 'platform', companyPhone: '' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { smsMode: 'own', companyPhone: null } });
    });

    it('intent=save-sms-secrets PUTs only the non-empty Twilio keys', async () => {
        await action(actionArgs({
            intent: 'save-sms-secrets',
            TWILIO_ACCOUNT_SID: 'ACnew', TWILIO_AUTH_TOKEN: '', TWILIO_FROM_NUMBER: '+15550001111',
        }));
        expect(putSecrets).toHaveBeenCalledWith({ json: { TWILIO_ACCOUNT_SID: 'ACnew', TWILIO_FROM_NUMBER: '+15550001111' } });
    });

    it('intent=test-sms posts the number and reports success', async () => {
        const res = await action(actionArgs({ intent: 'test-sms', to: '+15551234567' }));
        expect(postSmsTest).toHaveBeenCalledWith({ json: { to: '+15551234567' } });
        expect(res).toMatchObject({ intent: 'test-sms', ok: true });
    });

    it('intent=test-sms surfaces a fail-closed error (success=false)', async () => {
        postSmsTest.mockResolvedValue(jsonRes({ success: false, error: 'SMS is not configured.' }));
        const res = await action(actionArgs({ intent: 'test-sms', to: '+15551234567' }));
        expect(res).toMatchObject({ intent: 'test-sms', ok: false, error: 'SMS is not configured.' });
    });
});
