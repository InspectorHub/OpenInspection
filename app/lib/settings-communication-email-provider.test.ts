/**
 * Email provider abstraction (#195) — Settings → Communication email provider selector.
 *
 * BFF-seam approach: exercise the exported loader/action against a mocked
 * api-client. Asserts:
 *   - Loader surfaces emailByoProvider from tenant-config (default: 'resend').
 *   - save-email-secrets action reads email_byo_provider, PATCHes tenant-config,
 *     and PUTs only the non-empty keys for the selected provider.
 *   - Provider selection of 'sendgrid'/'postmark'/'mailgun' routes only those
 *     provider-specific keys to the secrets PUT.
 *   - Invalid (garbage) email_byo_provider values default to 'resend'.
 *
 * The rendered provider selector button group and per-provider SecretField
 * visibility are verified via Chrome MCP E2E.
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
const postResendTest = vi.fn();
const postSmsTest = vi.fn();

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
        smsAdmin: { sms: { config: { $get: getSmsConfig }, test: { $post: postSmsTest }, compliance: { $get: getSmsCompliance } } },
        integrations: {
            resend: { test: { $post: postResendTest } },
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
    getComm.mockReset().mockResolvedValue(jsonRes({ data: { emailMode: 'own' } }));
    getSecrets.mockReset().mockResolvedValue(jsonRes({ data: { RESEND_API_KEY: 're_••••1234' } }));
    getTemplates.mockReset().mockResolvedValue(jsonRes({ data: [] }));
    getSmsConfig.mockReset().mockResolvedValue(jsonRes({ data: { mode: 'platform', effectiveSource: 'none' } }));
    getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { smsMode: 'platform', emailByoProvider: 'resend' } }));
    getSmsCompliance.mockReset().mockResolvedValue(jsonRes({ data: { complianceStatus: 'not_started', rejectionReason: null } }));
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true, data: { ok: true } }));
    putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
    postResendTest.mockReset().mockResolvedValue(jsonRes({ data: { domains: 1 } }));
    postSmsTest.mockReset().mockResolvedValue(jsonRes({ success: true }));
});

// ─── Loader ──────────────────────────────────────────────────────────────────

describe('settings-communication loader — emailByoProvider', () => {
    it('surfaces emailByoProvider from tenant-config (explicit "resend")', async () => {
        const data = await loader(loaderArgs());
        expect(getTenantConfig).toHaveBeenCalled();
        expect(data.emailByoProvider).toBe('resend');
    });

    it('surfaces emailByoProvider = "sendgrid" when tenant-config returns it', async () => {
        getTenantConfig.mockResolvedValue(
            jsonRes({ data: { smsMode: 'platform', emailByoProvider: 'sendgrid' } }),
        );
        const data = await loader(loaderArgs());
        expect(data.emailByoProvider).toBe('sendgrid');
    });

    it('surfaces emailByoProvider = "postmark" when tenant-config returns it', async () => {
        getTenantConfig.mockResolvedValue(
            jsonRes({ data: { smsMode: 'platform', emailByoProvider: 'postmark' } }),
        );
        const data = await loader(loaderArgs());
        expect(data.emailByoProvider).toBe('postmark');
    });

    it('surfaces emailByoProvider = "mailgun" when tenant-config returns it', async () => {
        getTenantConfig.mockResolvedValue(
            jsonRes({ data: { smsMode: 'platform', emailByoProvider: 'mailgun' } }),
        );
        const data = await loader(loaderArgs());
        expect(data.emailByoProvider).toBe('mailgun');
    });

    it('defaults emailByoProvider to "resend" when tenant-config call fails', async () => {
        getTenantConfig.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.emailByoProvider).toBe('resend');
    });

    it('defaults emailByoProvider to "resend" when emailByoProvider field is absent', async () => {
        getTenantConfig.mockResolvedValue(jsonRes({ data: { smsMode: 'platform' } }));
        const data = await loader(loaderArgs());
        expect(data.emailByoProvider).toBe('resend');
    });

    it('exposes the new email secrets keys (SENDGRID_API_KEY, POSTMARK_SERVER_TOKEN, MAILGUN_API_KEY, MAILGUN_DOMAIN) in loader data', async () => {
        getSecrets.mockResolvedValue(jsonRes({
            data: {
                RESEND_API_KEY: 're_••••',
                SENDGRID_API_KEY: 'SG.••••',
                POSTMARK_SERVER_TOKEN: 'pm_••••',
                MAILGUN_API_KEY: 'mg_••••',
                MAILGUN_DOMAIN: 'mg.example.com',
            },
        }));
        const data = await loader(loaderArgs());
        expect(data.secrets.SENDGRID_API_KEY).toBe('SG.••••');
        expect(data.secrets.POSTMARK_SERVER_TOKEN).toBe('pm_••••');
        expect(data.secrets.MAILGUN_API_KEY).toBe('mg_••••');
        expect(data.secrets.MAILGUN_DOMAIN).toBe('mg.example.com');
    });
});

// ─── Action: save-email-secrets ───────────────────────────────────────────────

describe('settings-communication action — save-email-secrets intent', () => {
    it('PATCHes emailByoProvider="resend" and PUTs RESEND_API_KEY', async () => {
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'resend',
            RESEND_API_KEY: 're_newkey',
        }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: 'resend' } });
        expect(putSecrets).toHaveBeenCalledWith({ json: { RESEND_API_KEY: 're_newkey' } });
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: true });
    });

    it('PATCHes emailByoProvider="sendgrid" and PUTs SENDGRID_API_KEY', async () => {
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'sendgrid',
            SENDGRID_API_KEY: 'SG.newkey',
        }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: 'sendgrid' } });
        expect(putSecrets).toHaveBeenCalledWith({ json: { SENDGRID_API_KEY: 'SG.newkey' } });
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: true });
    });

    it('PATCHes emailByoProvider="postmark" and PUTs POSTMARK_SERVER_TOKEN', async () => {
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'postmark',
            POSTMARK_SERVER_TOKEN: 'pm_token',
        }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: 'postmark' } });
        expect(putSecrets).toHaveBeenCalledWith({ json: { POSTMARK_SERVER_TOKEN: 'pm_token' } });
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: true });
    });

    it('PATCHes emailByoProvider="mailgun" and PUTs MAILGUN_API_KEY + MAILGUN_DOMAIN', async () => {
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'mailgun',
            MAILGUN_API_KEY: 'key-abc',
            MAILGUN_DOMAIN: 'mg.example.com',
        }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: 'mailgun' } });
        expect(putSecrets).toHaveBeenCalledWith({ json: { MAILGUN_API_KEY: 'key-abc', MAILGUN_DOMAIN: 'mg.example.com' } });
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: true });
    });

    it('falls back to emailByoProvider="resend" on invalid/garbage provider value', async () => {
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'GARBAGE',
            RESEND_API_KEY: 're_key',
        }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: 'resend' } });
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: true });
    });

    it('returns error when PATCH /tenant-config fails', async () => {
        patchTenantConfig.mockResolvedValue(jsonRes(null, false));
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'resend',
            RESEND_API_KEY: 're_key',
        }));
        expect(putSecrets).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: false, error: 'Failed to save provider selection.' });
    });

    it('skips empty / whitespace-only secret values (no-op on blank form)', async () => {
        // Submitting provider without any key values is a no-op secrets PUT
        // (saveSecrets returns ok:true for empty body, but PATCH still fires).
        const res = await action(actionArgs({
            intent: 'save-email-secrets',
            email_byo_provider: 'sendgrid',
            SENDGRID_API_KEY: '   ',
        }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: 'sendgrid' } });
        // empty body → saveSecrets returns ok:true without calling putSecrets
        expect(putSecrets).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'save-email-secrets', ok: true });
    });
});
