/**
 * Track J Task 7 — Settings → Automations editor route (#121).
 *
 * happy-dom has no React render harness in this repo (see send-agreement-modal.spec.ts
 * / settings-compliance.spec.ts), so we exercise the exported loader/action directly
 * with a mocked BFF api-client, plus the pure helpers the editor UI relies on
 * (friendly trigger labels + the When/Only-if/Do-this conditions assembler). The
 * rendered modal / run-log / toggle rows are Chrome-verified.
 *
 * We assert:
 *   - loader fans out to automations list + services + recent logs + tenant-config
 *     via the BFF (no client fetch) and surfaces rules/services/recentLogs/reviewUrl.
 *   - the friendly trigger label map covers report.published + inspection.reminder.
 *   - the conditions assembler turns the Only-if checkboxes/serviceIds into the
 *     JSON gate object (or null when empty), and the save action persists it +
 *     forces channel 'email'.
 *   - the review-url save intent PATCHes tenant-config (empty → null).
 *   - toggle/delete intents hit PATCH/DELETE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the BFF seam (requireToken + createApi). ───────────────────────────
const getAutomations = vi.fn();
const postAutomation = vi.fn();
const patchAutomation = vi.fn();
const deleteAutomation = vi.fn();
const getRecentLogs = vi.fn();
const getServices = vi.fn();
const getTenantConfig = vi.fn();
const patchTenantConfig = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-123'),
}));

vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        automations: {
            index: { $get: getAutomations, $post: postAutomation },
            logs: { recent: { $get: getRecentLogs } },
            ':id': { $patch: patchAutomation, $delete: deleteAutomation },
        },
        services: {
            index: { $get: getServices },
        },
        admin: {
            'tenant-config': { $get: getTenantConfig, $patch: patchTenantConfig },
        },
    })),
}));

import { loader, action, TRIGGER_LABELS, buildConditions } from '~/routes/settings-automations';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true) {
    return { ok, json: async () => body } as unknown as Response;
}

function loaderArgs(): LoaderArgs {
    return {
        request: new Request('http://app.example.com/settings/automations'),
        context: {} as never,
        params: {},
    } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string | string[]>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
        if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
        else fd.set(k, v);
    }
    return {
        request: new Request('http://app.example.com/settings/automations', {
            method: 'POST',
            body: fd,
        }),
        context: {} as never,
        params: {},
    } as unknown as ActionArgs;
}

const RULE = {
    id: 'r1', name: 'Report Ready', trigger: 'report.published', recipient: 'client',
    delayMinutes: 0, subjectTemplate: 'S', bodyTemplate: 'B', conditions: null,
    channel: 'email', active: true, isDefault: true,
};
const LOG = {
    id: 'l1', recipientEmail: 'jane@x.com', sendAt: '2026-06-01T00:00:00Z',
    status: 'skipped', error: 'review_url not configured',
};

beforeEach(() => {
    getAutomations.mockReset().mockResolvedValue(jsonRes({ success: true, data: [RULE] }));
    postAutomation.mockReset().mockResolvedValue(jsonRes({ success: true, data: RULE }, true));
    patchAutomation.mockReset().mockResolvedValue(jsonRes({ success: true, data: RULE }));
    deleteAutomation.mockReset().mockResolvedValue(jsonRes({ success: true }));
    getRecentLogs.mockReset().mockResolvedValue(jsonRes({ success: true, data: [LOG] }));
    getServices.mockReset().mockResolvedValue(
        jsonRes({ success: true, data: [{ id: 'svc-1', name: 'Standard Home Inspection' }] }),
    );
    getTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true, data: { reviewUrl: 'https://g.page/r/x' } }));
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true, data: { ok: true } }));
});

describe('settings-automations trigger labels (#121)', () => {
    it('maps report.published to a friendly label', () => {
        expect(TRIGGER_LABELS['report.published']).toMatch(/Report published/i);
    });
    it('maps inspection.reminder to a reminder label', () => {
        expect(TRIGGER_LABELS['inspection.reminder']).toMatch(/reminder/i);
    });
});

describe('settings-automations buildConditions (Only if)', () => {
    it('returns null when nothing is set', () => {
        expect(buildConditions({ requirePaid: false, requireSigned: false, serviceIds: [] })).toBeNull();
    });
    it('assembles the gate object from the checkboxes + serviceIds', () => {
        expect(
            buildConditions({ requirePaid: true, requireSigned: false, serviceIds: ['svc-1'] }),
        ).toEqual({ requirePaid: true, serviceIds: ['svc-1'] });
    });
});

describe('settings-automations loader (BFF fan-out)', () => {
    it('surfaces rules, services, recentLogs and reviewUrl', async () => {
        const data = await loader(loaderArgs());
        expect(getAutomations).toHaveBeenCalled();
        expect(getServices).toHaveBeenCalled();
        expect(getRecentLogs).toHaveBeenCalled();
        expect(getTenantConfig).toHaveBeenCalled();
        expect(data.rules[0].name).toBe('Report Ready');
        expect(data.services[0].name).toBe('Standard Home Inspection');
        expect(data.recentLogs[0].error).toMatch(/review_url not configured/i);
        expect(data.reviewUrl).toBe('https://g.page/r/x');
    });

    it('degrades to empty/blank when the calls fail', async () => {
        getAutomations.mockResolvedValue(jsonRes(null, false));
        getServices.mockResolvedValue(jsonRes(null, false));
        getRecentLogs.mockResolvedValue(jsonRes(null, false));
        getTenantConfig.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.rules).toEqual([]);
        expect(data.services).toEqual([]);
        expect(data.recentLogs).toEqual([]);
        expect(data.reviewUrl).toBe('');
    });
});

describe('settings-automations action', () => {
    it('intent=save creates a new automation with assembled conditions + channel email', async () => {
        const res = await action(actionArgs({
            intent: 'save', name: 'New', trigger: 'report.published', recipient: 'client',
            delayMinutes: '0', subjectTemplate: 'S', bodyTemplate: 'B',
            requirePaid: 'on', serviceIds: ['svc-1', 'svc-2'],
        }));
        expect(postAutomation).toHaveBeenCalledTimes(1);
        const arg = postAutomation.mock.calls[0][0];
        expect(arg.json.channel).toBe('email');
        expect(arg.json.conditions).toEqual({ requirePaid: true, serviceIds: ['svc-1', 'svc-2'] });
        expect(res).toEqual({ ok: true, error: undefined });
    });

    it('intent=save returns { ok: false } when the API call fails (modal stays open)', async () => {
        postAutomation.mockResolvedValue(jsonRes({ success: false }, false));
        const res = await action(actionArgs({
            intent: 'save', name: 'New', trigger: 'report.published', recipient: 'client',
            delayMinutes: '0', subjectTemplate: 'S', bodyTemplate: 'B',
        }));
        expect(postAutomation).toHaveBeenCalledTimes(1);
        expect(res.ok).toBe(false);
    });

    it('intent=save with an id PATCHes the existing automation', async () => {
        await action(actionArgs({
            intent: 'save', id: 'r1', name: 'Edited', trigger: 'report.published',
            recipient: 'client', delayMinutes: '0', subjectTemplate: 'S', bodyTemplate: 'B',
        }));
        expect(patchAutomation).toHaveBeenCalledTimes(1);
        expect(patchAutomation.mock.calls[0][0].param).toEqual({ id: 'r1' });
        expect(postAutomation).not.toHaveBeenCalled();
    });

    it('intent=toggle flips active via PATCH', async () => {
        await action(actionArgs({ intent: 'toggle', id: 'r1', active: 'true' }));
        expect(patchAutomation).toHaveBeenCalledWith({ param: { id: 'r1' }, json: { active: false } });
    });

    it('intent=delete removes via DELETE', async () => {
        await action(actionArgs({ intent: 'delete', id: 'r1' }));
        expect(deleteAutomation).toHaveBeenCalledWith({ param: { id: 'r1' } });
    });

    it('intent=save-review-url PATCHes tenant-config (empty → null)', async () => {
        await action(actionArgs({ intent: 'save-review-url', reviewUrl: '' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { reviewUrl: null } });
    });
});
