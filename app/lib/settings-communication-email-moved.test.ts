/**
 * Communication no longer holds the email provider choice or keys.
 *
 * They moved to Integrations -> Email (`settings-integrations-email.test.tsx`
 * carries the provider and key tests that used to live here). What stays true on
 * THIS page, and is asserted below:
 *   - the loader hands the page only a yes/no for "the saved provider is
 *     complete" and the Google keys it still shows, never an email provider key;
 *   - the old key and provider intents are no longer handled here, so a stale
 *     form post cannot write a key or a provider from this page.
 *
 * (This file keeps its original name so history follows it; rename with git mv
 * if you want the name to match what it now covers.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getComm = vi.fn();
const getSecrets = vi.fn();
const getTemplates = vi.fn();
const getTenantConfig = vi.fn();
const patchTenantConfig = vi.fn();
const putSecrets = vi.fn();
const postValidate = vi.fn();
const postEmailStep = vi.fn();

vi.mock('~/lib/session.server', () => ({ requireToken: vi.fn(async () => 'tok-123') }));
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
        integrations: { email: { validate: { $post: postValidate } } },
        integrationsTestSteps: { email: { $post: postEmailStep } },
    })),
}));

import { loader, action } from '~/routes/settings-communication';
import { createLoadContext } from '~/lib/load-context';
import { granted } from '../../tests/helpers/loader-data';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

const jsonRes = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

const loaderArgs = (env: Record<string, string> = {}): LoaderArgs =>
    ({ request: new Request('http://app.example.com/settings/communication'), context: createLoadContext(env) as never, params: {} }) as unknown as LoaderArgs;

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/communication', { method: 'POST', body: fd }),
        context: createLoadContext() as never,
        params: {},
    } as unknown as ActionArgs;
}

beforeEach(() => {
    getComm.mockReset().mockResolvedValue(jsonRes({ data: { emailMode: 'own', senderEmail: 'me@acme.test' } }));
    getSecrets.mockReset().mockResolvedValue(jsonRes({ data: {
        RESEND_API_KEY: 're_••••1234', SENDGRID_API_KEY: 'SG.••••', GOOGLE_CLIENT_ID: 'gid_••••', TWILIO_AUTH_TOKEN: 'tw_••••',
    } }));
    getTemplates.mockReset().mockResolvedValue(jsonRes({ data: [] }));
    getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { emailByoProvider: 'resend' } }));
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true }));
    putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
    postValidate.mockReset().mockResolvedValue(jsonRes({ data: { ok: true } }));
    postEmailStep.mockReset().mockResolvedValue(jsonRes({ data: { status: 'pass', detail: null } }));
});

describe('settings-communication loader: no provider keys', () => {
    it('hands the page only whether the saved provider is complete, and the Google keys it still shows', async () => {
        const data = granted(await loader(loaderArgs()));
        expect(data.ownEmailConfigured).toBe(true);
        expect(Object.keys(data.secrets).sort()).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
        expect(data.secrets.GOOGLE_CLIENT_ID).toBe('gid_••••');
        // control: the stored email key really was in the secrets response, so its absence above is the loader's doing
        expect(JSON.stringify(data)).not.toContain('re_••••1234');
        expect(JSON.stringify(data)).not.toContain('SG.••••');
    });

    it('says the saved provider is not complete when its keys are missing', async () => {
        getSecrets.mockResolvedValue(jsonRes({ data: {} }));
        expect(granted(await loader(loaderArgs())).ownEmailConfigured).toBe(false);
    });

    it('judges completeness by the saved provider, not by any email key', async () => {
        getTenantConfig.mockResolvedValue(jsonRes({ data: { emailByoProvider: 'postmark' } }));
        expect(granted(await loader(loaderArgs())).ownEmailConfigured).toBe(false);
    });
});

describe('settings-communication loader: the sending account in force', () => {
    it('is the company\'s own where the deployment supplies no built-in sender, whatever the stored value says', async () => {
        getComm.mockResolvedValue(jsonRes({ data: { emailMode: 'platform' } }));
        expect(granted(await loader(loaderArgs({}))).effectiveEmailMode).toBe('own');
    });

    it('is the stored value where the deployment supplies one', async () => {
        getComm.mockResolvedValue(jsonRes({ data: { emailMode: 'platform' } }));
        expect(granted(await loader(loaderArgs({ APP_MODE: 'saas' }))).effectiveEmailMode).toBe('platform');
        getComm.mockResolvedValue(jsonRes({ data: { emailMode: 'own' } }));
        expect(granted(await loader(loaderArgs({ APP_MODE: 'saas' }))).effectiveEmailMode).toBe('own');
    });
});

describe('settings-communication action: email key and provider intents are gone from this page', () => {
    it.each([
        ['save-email-secrets', { email_byo_provider: 'resend', RESEND_API_KEY: 're_new' }],
        ['validate-email-provider', { provider: 'resend' }],
        ['test-email-step', { step: 'key_valid' }],
    ])('does not handle %s', async (intent, extra) => {
        await action(actionArgs({ intent, ...extra }));
        expect(putSecrets).not.toHaveBeenCalled();
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(postValidate).not.toHaveBeenCalled();
        expect(postEmailStep).not.toHaveBeenCalled();
    });

    it('still handles what stayed here: the Google client keys (control for the mocks above)', async () => {
        const res = await action(actionArgs({ intent: 'save-calendar-secrets', GOOGLE_CLIENT_ID: 'gid_new' }));
        expect(putSecrets).toHaveBeenCalledWith({ json: { GOOGLE_CLIENT_ID: 'gid_new' } });
        expect(res).toMatchObject({ intent: 'save-calendar-secrets', ok: true });
    });
});
