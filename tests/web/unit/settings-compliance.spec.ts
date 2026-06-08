/**
 * Track I-a G4 — Settings → Compliance route (BFF loader/action).
 *
 * happy-dom has no render harness (see send-agreement-modal.spec.ts), so we
 * exercise the exported loader/action directly with a mocked BFF api-client.
 * Rendered input/table/empty-state are Chrome-verified.
 *
 * We assert:
 *   - loader pulls retentionYears from GET /tenant-config (default 6) AND the
 *     erasure-log list from GET /compliance/erasure-log, via the BFF (no client
 *     fetch).
 *   - action intent=retention-save PATCHes tenant-config with the integer.
 *   - action rejects out-of-range retention years client-side (defense in depth)
 *     without calling the API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the BFF seam (requireToken + createApi). ───────────────────────────
const patchTenantConfig = vi.fn();
const getTenantConfig = vi.fn();
const getErasureLog = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-123'),
}));

vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        admin: {
            'tenant-config': {
                $get: getTenantConfig,
                $patch: patchTenantConfig,
            },
            compliance: {
                'erasure-log': {
                    $get: getErasureLog,
                },
            },
        },
    })),
}));

import { loader, action } from '~/routes/settings-compliance';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true) {
    return { ok, json: async () => body } as unknown as Response;
}

function loaderArgs(): LoaderArgs {
    return {
        request: new Request('http://app.example.com/settings/compliance'),
        context: {} as never,
        params: {},
    } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/compliance', {
            method: 'POST',
            body: fd,
        }),
        context: {} as never,
        params: {},
    } as unknown as ActionArgs;
}

beforeEach(() => {
    patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true, data: { ok: true } }));
    getTenantConfig.mockReset().mockResolvedValue(
        jsonRes({ success: true, data: { agreementRetentionYears: 9 } }),
    );
    getErasureLog.mockReset().mockResolvedValue(
        jsonRes({
            success: true,
            data: [
                {
                    id: 'e1',
                    subjectEmail: 'client@example.com',
                    status: 'completed',
                    retainedCount: 1,
                    anonymizedCount: 0,
                    deletedCount: 3,
                    decisions: [{ table: 'agreements', action: 'delete', count: 3 }],
                    createdAt: 1_700_000_000_000,
                },
            ],
        }),
    );
});

describe('settings-compliance loader (G4 BFF)', () => {
    it('returns the current retention years from the tenant-config endpoint', async () => {
        const data = await loader(loaderArgs());
        expect(getTenantConfig).toHaveBeenCalled();
        expect(data.retentionYears).toBe(9);
    });

    it('returns the erasure-log rows from the compliance endpoint', async () => {
        const data = await loader(loaderArgs());
        expect(getErasureLog).toHaveBeenCalled();
        expect(data.erasureLog).toHaveLength(1);
        expect(data.erasureLog[0].subjectEmail).toBe('client@example.com');
        expect(data.erasureLog[0].deletedCount).toBe(3);
    });

    it('falls back to the default of 6 when the config call fails', async () => {
        getTenantConfig.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.retentionYears).toBe(6);
    });

    it('tolerates an erasure-log fetch failure with an empty list', async () => {
        getErasureLog.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.erasureLog).toEqual([]);
    });
});

describe('settings-compliance action (G4 BFF)', () => {
    it('intent=retention-save PATCHes tenant-config with the integer year', async () => {
        const res = await action(actionArgs({ intent: 'retention-save', retentionYears: '8' }));
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { agreementRetentionYears: 8 } });
        expect(res).toMatchObject({ ok: true, intent: 'retention-save' });
    });

    it.each(['0', '100', '6.5', 'abc', ''])(
        'rejects invalid retention input %s without calling the API',
        async (bad) => {
            const res = await action(actionArgs({ intent: 'retention-save', retentionYears: bad }));
            expect(patchTenantConfig).not.toHaveBeenCalled();
            expect(res).toMatchObject({ ok: false, intent: 'retention-save' });
        },
    );

    it('surfaces a server error message when the PATCH fails', async () => {
        patchTenantConfig.mockResolvedValue(
            jsonRes({ error: { message: 'nope' } }, false),
        );
        const res = await action(actionArgs({ intent: 'retention-save', retentionYears: '8' }));
        expect(res).toMatchObject({ ok: false, intent: 'retention-save', message: 'nope' });
    });
});
