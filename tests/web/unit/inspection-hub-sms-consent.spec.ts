/**
 * Track L (Task 9, Part E) — inspection-hub SMS consent status + attestation.
 *
 * Same BFF-seam approach as settings-automations.spec.ts (no React render
 * harness in this repo): exercise the exported loader/action directly against a
 * mocked api-client. We assert the loader surfaces the client's SMS consent
 * (via GET /sms/consent, degrading to 'none' on failure) and the attest action
 * posts to /sms/attest. The rendered ClientSmsConsent affordance is Chrome-verified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getHub = vi.fn();
const getConsent = vi.fn();
const postAttest = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-123'),
}));

vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        inspections: { ':id': { hub: { $get: getHub } } },
        // request-payment / agreement / publish unused in these cases
        invoices: { 'request-payment': { $post: vi.fn() } },
        smsAdmin: { sms: { consent: { $get: getConsent }, attest: { $post: postAttest } } },
    })),
}));

import { loader, action } from '~/routes/inspection-hub';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 404, json: async () => body } as unknown as Response;
}

function loaderArgs(): LoaderArgs {
    return {
        request: new Request('http://app.example.com/inspections/insp-1'),
        context: {} as never,
        params: { id: 'insp-1' },
    } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/inspections/insp-1', { method: 'POST', body: fd }),
        context: {} as never,
        params: { id: 'insp-1' },
    } as unknown as ActionArgs;
}

const HUB = { success: true, data: { inspection: { id: 'insp-1' }, people: {}, services: [], tenantSlug: 'acme' } };

beforeEach(() => {
    getHub.mockReset().mockResolvedValue(jsonRes(HUB));
    getConsent.mockReset().mockResolvedValue(jsonRes({ success: true, data: { consent: 'granted' } }));
    postAttest.mockReset().mockResolvedValue(jsonRes({ success: true }));
});

describe('inspection-hub loader — SMS consent (Part E)', () => {
    it('surfaces the client consent status from GET /sms/consent', async () => {
        const data = await loader(loaderArgs());
        expect(getConsent).toHaveBeenCalledWith({ query: { inspectionId: 'insp-1' } });
        expect(data.smsConsent).toBe('granted');
    });

    it('degrades to "none" when the consent call fails', async () => {
        getConsent.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.smsConsent).toBe('none');
    });

    it('reads revoked consent through unchanged', async () => {
        getConsent.mockResolvedValue(jsonRes({ success: true, data: { consent: 'revoked' } }));
        const data = await loader(loaderArgs());
        expect(data.smsConsent).toBe('revoked');
    });
});

describe('inspection-hub action — attest-sms (Part E)', () => {
    it('intent=attest-sms posts to /sms/attest with the inspection id', async () => {
        const res = await action(actionArgs({ intent: 'attest-sms' }));
        expect(postAttest).toHaveBeenCalledWith({ json: { inspectionId: 'insp-1' } });
        expect(res).toEqual({ ok: true, intent: 'attest-sms', error: undefined });
    });

    it('intent=attest-sms surfaces the API error (never unconditional ok)', async () => {
        postAttest.mockResolvedValue(jsonRes({ error: { message: 'no client to attest' } }, false));
        const res = await action(actionArgs({ intent: 'attest-sms' }));
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/no client to attest/i);
    });
});
