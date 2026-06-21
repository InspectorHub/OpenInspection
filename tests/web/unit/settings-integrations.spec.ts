/**
 * Settings → Integrations — Video section (Task 7).
 *
 * Tests the loader's exposure of videoMode + streamCustomerSubdomain, and the
 * three action intents (save-stripe-secrets, test-stripe, save-video).
 *
 * The video section is self-host-only; isSaas gating is enforced in the render
 * layer (the loader always exposes the fields — the panel itself is hidden when
 * ctx.branding.isSaas is true, which is verified via E2E / Chrome MCP).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSecrets = vi.fn();
const putSecrets = vi.fn();
const getStripeWebhookLog = vi.fn();
const postStripeTest = vi.fn();
const getAdminConfig = vi.fn();
const postAdminConfig = vi.fn();
const getTenantConfig = vi.fn();
const patchTenantConfig = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-123'),
}));

vi.mock('~/lib/access.server', () => ({
    requireAdminLoader: vi.fn(async () => ({ forbidden: false, token: 'tok-123' })),
}));

vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        secrets: { secrets: { $get: getSecrets, $put: putSecrets } },
        integrations: {
            stripe: {
                'webhook-log': { $get: getStripeWebhookLog },
                test: { $post: postStripeTest },
            },
        },
        admin: {
            config: { $get: getAdminConfig, $post: postAdminConfig },
            'tenant-config': { $get: getTenantConfig, $patch: patchTenantConfig },
        },
    })),
}));

import { loader, action } from '~/routes/settings-integrations';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true) {
    return { ok, json: async () => body } as unknown as Response;
}

function loaderArgs(): LoaderArgs {
    return {
        request: new Request('http://app.example.com/settings/integrations'),
        context: {} as never,
        params: {},
    } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/integrations', {
            method: 'POST',
            body: fd,
        }),
        context: {} as never,
        params: {},
    } as unknown as ActionArgs;
}

beforeEach(() => {
    getSecrets.mockReset().mockResolvedValue(jsonRes({ data: {} }));
    putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
    getStripeWebhookLog.mockReset().mockResolvedValue(jsonRes({ data: [] }));
    postStripeTest.mockReset().mockResolvedValue(jsonRes({ data: { accountName: 'Test', livemode: false } }));
    getAdminConfig.mockReset().mockResolvedValue(
        jsonRes({ data: { integrationConfig: { streamCustomerSubdomain: 'customer.cloudflarestream.com' } } }),
    );
    postAdminConfig.mockReset().mockResolvedValue(jsonRes({ success: true }));
    getTenantConfig.mockReset().mockResolvedValue(
        jsonRes({ data: { videoMode: 'r2', smsMode: 'platform' } }),
    );
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true, data: { ok: true } }));
});

// ─── Loader ──────────────────────────────────────────────────────────────────

describe('settings-integrations loader — video fields', () => {
    it('exposes videoMode (r2 default) and streamCustomerSubdomain from config', async () => {
        const data = await loader(loaderArgs());
        if ('forbidden' in data) throw new Error('should not be forbidden');
        expect(data.videoMode).toBe('r2');
        expect(data.streamCustomerSubdomain).toBe('customer.cloudflarestream.com');
    });

    it('falls back to r2 + empty subdomain when API calls fail', async () => {
        getAdminConfig.mockResolvedValue(jsonRes(null, false));
        getTenantConfig.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        if ('forbidden' in data) throw new Error('should not be forbidden');
        expect(data.videoMode).toBe('r2');
        expect(data.streamCustomerSubdomain).toBe('');
    });

    it('surfaces stream videoMode when tenant-config returns stream', async () => {
        getTenantConfig.mockResolvedValue(
            jsonRes({ data: { videoMode: 'stream', smsMode: 'platform' } }),
        );
        const data = await loader(loaderArgs());
        if ('forbidden' in data) throw new Error('should not be forbidden');
        expect(data.videoMode).toBe('stream');
    });
});

// ─── Action: save-video ───────────────────────────────────────────────────────

describe('settings-integrations action — save-video intent', () => {
    it('saves r2 mode: PATCHes videoMode=r2 and POSTs config without subdomain', async () => {
        const res = await action(actionArgs({ intent: 'save-video', videoMode: 'r2' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { videoMode: 'r2' } });
        expect(postAdminConfig).toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'save-video', success: true });
    });

    it('saves stream mode with valid subdomain: PATCHes videoMode=stream and POSTs config with subdomain', async () => {
        const res = await action(
            actionArgs({
                intent: 'save-video',
                videoMode: 'stream',
                streamCustomerSubdomain: 'my.cloudflarestream.com',
            }),
        );
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { videoMode: 'stream' } });
        const configCall = postAdminConfig.mock.calls[0][0] as { json: Record<string, string> };
        expect(configCall.json.streamCustomerSubdomain).toBe('my.cloudflarestream.com');
        expect(res).toMatchObject({ intent: 'save-video', success: true });
    });

    it('rejects stream mode with empty subdomain', async () => {
        const res = await action(
            actionArgs({ intent: 'save-video', videoMode: 'stream', streamCustomerSubdomain: '' }),
        );
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(res).toMatchObject({
            intent: 'save-video',
            success: false,
            field: 'streamCustomerSubdomain',
        });
    });

    it('rejects stream mode with invalid hostname', async () => {
        const res = await action(
            actionArgs({
                intent: 'save-video',
                videoMode: 'stream',
                streamCustomerSubdomain: 'not a hostname!',
            }),
        );
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(res).toMatchObject({
            intent: 'save-video',
            success: false,
            field: 'streamCustomerSubdomain',
        });
    });

    it('removes streamCustomerSubdomain from integrationConfig when reverting to r2', async () => {
        // Existing config has subdomain; switching to r2 should clear it.
        getAdminConfig.mockResolvedValue(
            jsonRes({ data: { integrationConfig: { streamCustomerSubdomain: 'old.example.com', appBaseUrl: 'https://example.com' } } }),
        );
        await action(actionArgs({ intent: 'save-video', videoMode: 'r2' }));
        const configCall = postAdminConfig.mock.calls[0][0] as { json: Record<string, string> };
        expect(configCall.json.streamCustomerSubdomain).toBeUndefined();
        // Other integrationConfig fields are preserved.
        expect(configCall.json.appBaseUrl).toBe('https://example.com');
    });

    it('surfaces an error when PATCH /tenant-config fails', async () => {
        patchTenantConfig.mockResolvedValue(jsonRes(null, false));
        const res = await action(actionArgs({ intent: 'save-video', videoMode: 'r2' }));
        expect(res).toMatchObject({ intent: 'save-video', success: false });
    });

    it('returns error and makes no writes when GET /admin/config fails', async () => {
        // Simulate the config GET returning a non-ok response.
        getAdminConfig.mockResolvedValue(jsonRes(null, false));
        const res = await action(actionArgs({ intent: 'save-video', videoMode: 'r2' }));
        // No writes should happen — atomic: GET must succeed before PATCH/POST.
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(postAdminConfig).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'save-video', success: false });
        expect((res as { error: string }).error).toMatch(/Failed to read current configuration/);
    });

    it('returns error and makes no writes when GET /admin/config throws', async () => {
        // Simulate a network-level failure (catch(() => null) path).
        getAdminConfig.mockRejectedValue(new Error('network error'));
        const res = await action(actionArgs({ intent: 'save-video', videoMode: 'r2' }));
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(postAdminConfig).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'save-video', success: false });
    });

    it('returns error when POST /admin/config fails', async () => {
        postAdminConfig.mockResolvedValue(jsonRes(null, false));
        const res = await action(actionArgs({ intent: 'save-video', videoMode: 'r2' }));
        expect(res).toMatchObject({ intent: 'save-video', success: false });
        expect((res as { error: string }).error).toMatch(/Failed to save integration configuration/);
    });

    it('rejects save-video in SaaS mode', async () => {
        // Simulate APP_MODE=saas via context.cloudflare.env.
        const sasArgs = {
            request: new Request('http://app.example.com/settings/integrations', {
                method: 'POST',
                body: (() => { const fd = new FormData(); fd.set('intent', 'save-video'); fd.set('videoMode', 'r2'); return fd; })(),
            }),
            context: { cloudflare: { env: { APP_MODE: 'saas' } } } as never,
            params: {},
        } as unknown as Parameters<typeof action>[0];
        const res = await action(sasArgs);
        // SaaS guard fires before any API call.
        expect(getAdminConfig).not.toHaveBeenCalled();
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(postAdminConfig).not.toHaveBeenCalled();
        expect(res).toMatchObject({ intent: 'save-video', success: false });
        expect((res as { error: string }).error).toMatch(/plan-managed/);
    });
});

// ─── Action: unknown intent ───────────────────────────────────────────────────

describe('settings-integrations action — unknown intent', () => {
    it('returns an error for an unknown intent', async () => {
        const res = await action(actionArgs({ intent: 'bogus' }));
        expect(res).toMatchObject({ success: false, error: 'Unknown action' });
    });
});
