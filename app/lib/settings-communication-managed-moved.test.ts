/**
 * Communication no longer runs managed SMS onboarding.
 *
 * The wizard's intents (start, resubmit, choose carrier) moved to Integrations ->
 * SMS (`settings-integrations-sms.test.tsx` carries the tests that used to live
 * here). Asserted below: a stale form post for any of them reaches no API from
 * this page, even on a deployment that offers managed onboarding.
 *
 * (This file keeps its original name so history follows it; rename with git mv
 * if you want the name to match what it now covers.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const postProvision = vi.fn();
const postResubmit = vi.fn();
const patchTenantConfig = vi.fn();

vi.mock('~/lib/session.server', () => ({ requireToken: vi.fn(async () => 'tok-123') }));
vi.mock('~/lib/access.server', () => ({
    requireAdminLoader: vi.fn(async () => ({ forbidden: false, token: 'tok-123' })),
}));
vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        admin: {
            communication: { $get: vi.fn(), $patch: vi.fn() },
            'tenant-config': { $get: vi.fn(), $patch: patchTenantConfig },
        },
        smsAdmin: { sms: { compliance: { provision: { $post: postProvision }, resubmit: { $post: postResubmit } } } },
    })),
}));

import { action } from '~/routes/settings-communication';
import { createLoadContext } from '~/lib/load-context';

type ActionArgs = Parameters<typeof action>[0];

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/communication', { method: 'POST', body: fd }),
        // A deployment that offers managed onboarding: the old action would have run it.
        context: createLoadContext({ APP_MODE: 'saas' }) as never,
        params: {},
    } as unknown as ActionArgs;
}

beforeEach(() => {
    postProvision.mockReset();
    postResubmit.mockReset();
    patchTenantConfig.mockReset();
});

describe('settings-communication action: managed SMS onboarding is gone from this page', () => {
    const BUSINESS = { legalName: 'Acme Inspection LLC', address: '123 Main St', repName: 'Jane Smith', channel: 'sp10dlc' };

    it.each([
        ['sms-compliance-provision', BUSINESS],
        ['sms-compliance-resubmit', BUSINESS],
        ['save-managed-provider', { managedProvider: 'telnyx' }],
    ])('does not handle %s', async (intent, extra) => {
        await action(actionArgs({ intent, ...extra }));
        expect(postProvision).not.toHaveBeenCalled();
        expect(postResubmit).not.toHaveBeenCalled();
        expect(patchTenantConfig).not.toHaveBeenCalled();
    });
});
