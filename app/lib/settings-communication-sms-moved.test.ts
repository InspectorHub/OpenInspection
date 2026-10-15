/**
 * Communication no longer holds anything about SMS delivery.
 *
 * The SMS provider, keys, company phone and compliance status moved to
 * Integrations -> SMS (`settings-integrations-sms.test.tsx` carries the tests
 * that used to live here). Asserted below:
 *   - the loader no longer reads the SMS configuration or compliance and hands
 *     the page no SMS key, phone or status;
 *   - the old SMS intents are no longer handled here, so a stale form post
 *     cannot write a key, a mode or send a test message from this page.
 *
 * (This file keeps its original name so history follows it; rename with git mv
 * if you want the name to match what it now covers.)
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
        smsAdmin: { sms: { config: { $get: getSmsConfig }, test: { $post: postSmsTest }, compliance: { $get: getSmsCompliance } } },
        integrations: { 'test-results': { $get: vi.fn() } },
    })),
}));

import { loader, action } from '~/routes/settings-communication';
import { createLoadContext } from '~/lib/load-context';
import { granted } from '../../tests/helpers/loader-data';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

const jsonRes = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;

const loaderArgs = (): LoaderArgs =>
    ({ request: new Request('http://app.example.com/settings/communication'), context: createLoadContext() as never, params: {} }) as unknown as LoaderArgs;

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
    getComm.mockReset().mockResolvedValue(jsonRes({ data: { emailMode: 'platform' } }));
    getSecrets.mockReset().mockResolvedValue(jsonRes({ data: { TWILIO_ACCOUNT_SID: 'AC••••1234', GOOGLE_CLIENT_ID: 'gid_••••' } }));
    getTemplates.mockReset().mockResolvedValue(jsonRes({ data: [] }));
    getSmsConfig.mockReset().mockResolvedValue(jsonRes({ data: { mode: 'own', effectiveSource: 'own' } }));
    getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { smsMode: 'own', companyPhone: '+15551112222' } }));
    getSmsCompliance.mockReset().mockResolvedValue(jsonRes({ data: { complianceStatus: 'approved' } }));
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true }));
    putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
    postSmsTest.mockReset().mockResolvedValue(jsonRes({ success: true }));
});

describe('settings-communication loader: nothing about SMS delivery', () => {
    it('does not read the SMS configuration or compliance, and returns no SMS key, phone or status', async () => {
        const data = granted(await loader(loaderArgs()));
        expect(getSmsConfig).not.toHaveBeenCalled();
        expect(getSmsCompliance).not.toHaveBeenCalled();
        const keys = Object.keys(data);
        for (const gone of ['smsConfig', 'companyPhone', 'byoProvider', 'compliance', 'managedProvider', 'testResults']) {
            expect(keys, gone).not.toContain(gone);
        }
        expect(JSON.stringify(data)).not.toContain('AC••••1234');
        // control: the loader still returned the things this page keeps
        expect(keys).toContain('emailTemplates');
        expect(data.secrets.GOOGLE_CLIENT_ID).toBe('gid_••••');
    });
});

describe('settings-communication action: SMS intents are gone from this page', () => {
    it.each([
        ['save-sms-config', { smsMode: 'own', companyPhone: '+15553334444' }],
        ['save-sms-secrets', { TWILIO_ACCOUNT_SID: 'ACnew' }],
        ['test-sms', { to: '+15551234567' }],
    ])('does not handle %s', async (intent, extra) => {
        await action(actionArgs({ intent, ...extra }));
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(putSecrets).not.toHaveBeenCalled();
        expect(postSmsTest).not.toHaveBeenCalled();
    });
});
