/**
 * Task 9 — Settings → Communication: Managed compliance onboarding wizard.
 *
 * BFF-seam approach (same harness as settings-communication-sms.spec.ts):
 * exercise the exported loader and action against a mocked api-client.
 *
 * Assertions:
 *   - Loader surfaces managed sub-statuses (customerProfileStatus, brandStatus,
 *     campaignStatus, tfvStatus, messagingServiceSid, provisionedNumber) from
 *     GET .../compliance.
 *   - Loader degrades gracefully when the compliance call fails.
 *   - intent=sms-compliance-provision POSTs the correct businessInfo + channel.
 *   - intent=sms-compliance-resubmit POSTs the correct businessInfo + channel.
 *   - Both intents validate required fields (legalName, address, repName) before
 *     hitting the API.
 *   - Both intents surface a clean error on API failure (403 standalone, 409 missing keys).
 *
 * NOTE: Chrome E2E (wizard renders → form fills → provision click → timeline
 * updates) is OUT OF SCOPE in this vitest run and requires a running dev server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the BFF seam ──────────────────────────────────────────────────────
const getComm = vi.fn();
const getSecrets = vi.fn();
const getTemplates = vi.fn();
const getSmsConfig = vi.fn();
const getTenantConfig = vi.fn();
const getSmsCompliance = vi.fn();
const patchTenantConfig = vi.fn();
const putSecrets = vi.fn();
const postSmsTest = vi.fn();
const postProvision = vi.fn();
const postResubmit = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-123'),
}));

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
        smsAdmin: {
            sms: {
                config: { $get: getSmsConfig },
                test: { $post: postSmsTest },
                compliance: {
                    $get: getSmsCompliance,
                    provision: { $post: postProvision },
                    resubmit: { $post: postResubmit },
                },
            },
        },
        integrations: {
            resend: { test: { $post: vi.fn() } },
            email: { validate: { $post: vi.fn() } },
            'test-results': { $get: () => Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) }) },
        },
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

function actionArgs(form: Record<string, string>, appMode: 'saas' | 'standalone' = 'saas'): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/communication', { method: 'POST', body: fd }),
        // The managed-compliance action gates on SaaS via context.cloudflare.env.APP_MODE.
        context: { cloudflare: { env: { APP_MODE: appMode } } } as never,
        params: {},
    } as unknown as ActionArgs;
}

const MANAGED_COMPLIANCE_BODY = {
    data: {
        mode: 'managed_dedicated',
        complianceStatus: 'profile_pending',
        rejectionReason: null,
        tollfree: [],
        customerProfileStatus: 'pending-review',
        brandStatus: null,
        campaignStatus: null,
        tfvStatus: null,
        messagingServiceSid: 'MGxxx',
        provisionedNumber: '+15559990000',
    },
};

const REJECTED_COMPLIANCE_BODY = {
    data: {
        mode: 'managed_dedicated',
        complianceStatus: 'rejected',
        rejectionReason: 'Website URL does not match business registration.',
        tollfree: [],
        customerProfileStatus: 'rejected',
        brandStatus: null,
        campaignStatus: null,
        tfvStatus: null,
        messagingServiceSid: null,
        provisionedNumber: null,
    },
};

beforeEach(() => {
    getComm.mockReset().mockResolvedValue(jsonRes({ data: { emailMode: 'platform' } }));
    getSecrets.mockReset().mockResolvedValue(jsonRes({ data: { TWILIO_ACCOUNT_SID: 'AC••••1234' } }));
    getTemplates.mockReset().mockResolvedValue(jsonRes({ data: [] }));
    getSmsConfig.mockReset().mockResolvedValue(jsonRes({ data: { mode: 'managed_dedicated', effectiveSource: 'none' } }));
    getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { smsMode: 'managed_dedicated', companyPhone: '' } }));
    getSmsCompliance.mockReset().mockResolvedValue(jsonRes(MANAGED_COMPLIANCE_BODY));
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true }));
    putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
    postSmsTest.mockReset().mockResolvedValue(jsonRes({ success: true }));
    postProvision.mockReset().mockResolvedValue(jsonRes({ success: true, data: MANAGED_COMPLIANCE_BODY.data }));
    postResubmit.mockReset().mockResolvedValue(jsonRes({ success: true, data: MANAGED_COMPLIANCE_BODY.data }));
});

// ── Loader: managed sub-status fields ────────────────────────────────────────

describe('settings-communication loader — managed compliance sub-statuses (Task 9)', () => {
    it('surfaces customerProfileStatus, brandStatus, campaignStatus, tfvStatus, messagingServiceSid, provisionedNumber', async () => {
        const data = await loader(loaderArgs());
        expect(data.compliance).toMatchObject({
            complianceStatus: 'profile_pending',
            rejectionReason: null,
            customerProfileStatus: 'pending-review',
            brandStatus: null,
            campaignStatus: null,
            tfvStatus: null,
            messagingServiceSid: 'MGxxx',
            provisionedNumber: '+15559990000',
        });
    });

    it('surfaces rejectionReason and sub-statuses when status is rejected', async () => {
        getSmsCompliance.mockResolvedValue(jsonRes(REJECTED_COMPLIANCE_BODY));
        const data = await loader(loaderArgs());
        expect(data.compliance).toMatchObject({
            complianceStatus: 'rejected',
            rejectionReason: 'Website URL does not match business registration.',
            customerProfileStatus: 'rejected',
            brandStatus: null,
            messagingServiceSid: null,
            provisionedNumber: null,
        });
    });

    it('degrades all sub-status fields to null when the compliance call fails', async () => {
        getSmsCompliance.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.compliance).toMatchObject({
            complianceStatus: 'not_started',
            rejectionReason: null,
            customerProfileStatus: null,
            brandStatus: null,
            campaignStatus: null,
            tfvStatus: null,
            messagingServiceSid: null,
            provisionedNumber: null,
        });
    });
});

// ── Action: sms-compliance-provision ─────────────────────────────────────────

describe('settings-communication action — intent=sms-compliance-provision (Task 9)', () => {
    it('POSTs businessInfo + channel to the provision endpoint', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme Inspection LLC',
            address: '123 Main St, Springfield, IL 62701',
            repName: 'Jane Smith',
            email: 'jane@acme.com',
            areaCode: '415',
            channel: 'sp10dlc',
        }));
        expect(postProvision).toHaveBeenCalledWith({
            json: {
                businessInfo: {
                    legalName: 'Acme Inspection LLC',
                    address: '123 Main St, Springfield, IL 62701',
                    repName: 'Jane Smith',
                    email: 'jane@acme.com',
                    areaCode: '415',
                },
                channel: 'sp10dlc',
            },
        });
        expect(res).toMatchObject({ intent: 'sms-compliance-provision', ok: true });
    });

    it('omits optional fields (email, areaCode) when blank', async () => {
        await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme',
            address: '123 Main St',
            repName: 'Jane',
            email: '',
            areaCode: '',
            channel: 'tollfree',
        }));
        const call = postProvision.mock.calls[0][0] as { json: { businessInfo: Record<string, string>; channel: string } };
        expect(call.json.businessInfo).not.toHaveProperty('email');
        expect(call.json.businessInfo).not.toHaveProperty('areaCode');
        expect(call.json.channel).toBe('tollfree');
    });

    it('returns ok=false without calling the API when legalName is missing', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: '',
            address: '123 Main St',
            repName: 'Jane',
            channel: 'sp10dlc',
        }));
        expect(postProvision).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-provision', ok: false, field: 'legalName' });
    });

    it('blocks the provision intent in standalone mode (no API call)', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme Inspection LLC',
            address: '123 Main St, Springfield, IL 62701',
            repName: 'Jane Smith',
            channel: 'sp10dlc',
        }, 'standalone'));
        expect(postProvision).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-provision', ok: false });
    });

    it('returns ok=false without calling the API when address is missing', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme',
            address: '',
            repName: 'Jane',
            channel: 'sp10dlc',
        }));
        expect(postProvision).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-provision', ok: false, field: 'address' });
    });

    it('returns ok=false without calling the API when repName is missing', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme',
            address: '123 Main St',
            repName: '',
            channel: 'sp10dlc',
        }));
        expect(postProvision).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-provision', ok: false, field: 'repName' });
    });

    it('returns ok=false without calling the API when email is invalid', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme',
            address: '123 Main St',
            repName: 'Jane',
            email: 'not-an-email',
            channel: 'sp10dlc',
        }));
        expect(postProvision).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-provision', ok: false, field: 'email' });
    });

    it('surfaces the standalone error from a 403 API response', async () => {
        postProvision.mockResolvedValue(jsonRes({ error: 'managed_provision_unavailable' }, false));
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme',
            address: '123 Main St',
            repName: 'Jane',
            channel: 'sp10dlc',
        }));
        expect(res).toMatchObject({
            intent: 'sms-compliance-provision',
            ok: false,
            error: 'Managed SMS provisioning is not available in standalone mode.',
        });
    });

    it('surfaces the missing-keys error from a 409 API response', async () => {
        postProvision.mockResolvedValue(jsonRes({ error: 'managed_not_configured' }, false));
        const res = await action(actionArgs({
            intent: 'sms-compliance-provision',
            legalName: 'Acme',
            address: '123 Main St',
            repName: 'Jane',
            channel: 'sp10dlc',
        }));
        expect(res).toMatchObject({
            intent: 'sms-compliance-provision',
            ok: false,
            error: 'Managed Twilio credentials are not configured on this deployment.',
        });
    });
});

// ── Action: sms-compliance-resubmit ──────────────────────────────────────────

describe('settings-communication action — intent=sms-compliance-resubmit (Task 9)', () => {
    it('POSTs businessInfo + channel to the resubmit endpoint', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-resubmit',
            legalName: 'Acme Inspection LLC',
            address: '123 Main St, Springfield, IL 62701',
            repName: 'Jane Smith',
            channel: 'tollfree',
        }));
        expect(postResubmit).toHaveBeenCalledWith({
            json: {
                businessInfo: {
                    legalName: 'Acme Inspection LLC',
                    address: '123 Main St, Springfield, IL 62701',
                    repName: 'Jane Smith',
                },
                channel: 'tollfree',
            },
        });
        expect(postProvision).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-resubmit', ok: true });
    });

    it('returns ok=false without calling the API when required fields are missing', async () => {
        const res = await action(actionArgs({
            intent: 'sms-compliance-resubmit',
            legalName: 'Acme',
            address: '',
            repName: 'Jane',
            channel: 'tollfree',
        }));
        expect(postResubmit).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'sms-compliance-resubmit', ok: false, field: 'address' });
    });

    it('surfaces a server error from a failed resubmit', async () => {
        postResubmit.mockResolvedValue(jsonRes({ error: 'server_error' }, false));
        const res = await action(actionArgs({
            intent: 'sms-compliance-resubmit',
            legalName: 'Acme',
            address: '123 Main St',
            repName: 'Jane',
            channel: 'tollfree',
        }));
        expect(res).toMatchObject({ intent: 'sms-compliance-resubmit', ok: false });
    });
});

// ── Task 5: managed provider selector ────────────────────────────────────────

describe('settings-communication loader — managedProvider field (Task 5)', () => {
    it('defaults managedProvider to "twilio" when tenantCfg does not include it', async () => {
        // Default mock returns { smsMode, companyPhone } — no managedProvider key.
        const data = await loader(loaderArgs());
        expect((data as Record<string, unknown>).managedProvider).toBe('twilio');
    });

    it('surfaces managedProvider: "telnyx" when tenantCfg stores telnyx', async () => {
        getTenantConfig.mockResolvedValue(
            jsonRes({ data: { smsMode: 'managed_dedicated', companyPhone: '', managedProvider: 'telnyx' } }),
        );
        const data = await loader(loaderArgs());
        expect((data as Record<string, unknown>).managedProvider).toBe('telnyx');
    });

    it('falls back to "twilio" when tenantCfg returns a null managedProvider', async () => {
        getTenantConfig.mockResolvedValue(
            jsonRes({ data: { smsMode: 'managed_dedicated', companyPhone: '', managedProvider: null } }),
        );
        const data = await loader(loaderArgs());
        expect((data as Record<string, unknown>).managedProvider).toBe('twilio');
    });
});

describe('settings-communication action — intent=save-managed-provider (Task 5)', () => {
    it('PATCHes managedProvider: "telnyx" when telnyx is selected', async () => {
        const res = await action(actionArgs({ intent: 'save-managed-provider', managedProvider: 'telnyx' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { managedProvider: 'telnyx' } });
        expect(res).toMatchObject({ intent: 'save-managed-provider', ok: true });
    });

    it('PATCHes managedProvider: "twilio" when twilio is selected', async () => {
        const res = await action(actionArgs({ intent: 'save-managed-provider', managedProvider: 'twilio' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { managedProvider: 'twilio' } });
        expect(res).toMatchObject({ intent: 'save-managed-provider', ok: true });
    });

    it('defaults to "twilio" when no managedProvider value is submitted', async () => {
        const res = await action(actionArgs({ intent: 'save-managed-provider' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { managedProvider: 'twilio' } });
        expect(res).toMatchObject({ intent: 'save-managed-provider', ok: true });
    });

    it('returns ok=false when the tenant-config PATCH fails', async () => {
        patchTenantConfig.mockResolvedValue(jsonRes({ error: 'server_error' }, false));
        const res = await action(actionArgs({ intent: 'save-managed-provider', managedProvider: 'telnyx' }));
        expect(res).toMatchObject({ intent: 'save-managed-provider', ok: false });
    });
});
