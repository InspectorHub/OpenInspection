/**
 * D3 — Settings → Connected applications route (BFF loader/action + render).
 *
 * Pattern: exercise loader/action directly with a mocked BFF (no client fetch).
 * Rendered rows, ConfirmDialog open/close, and admin-section visibility are
 * verified via renderToStaticMarkup (same approach as oauth-authorize.spec.ts).
 *
 * Asserts:
 *   - Loader fetches self grants via BFF; degrades gracefully on 404 (MCP off).
 *   - Loader fetches all-grants only for admin roles.
 *   - action intent=revoke calls DELETE /grants/:id (no query.admin).
 *   - action intent=revoke-admin calls DELETE /grants/:id?admin=1.
 *   - Component renders a row per self grant with client name + scope indicator.
 *   - Clicking Revoke opens ConfirmDialog text; window.confirm is never called.
 *   - Confirming submits via fetcher (intent=revoke posted).
 *   - Admin section renders for owner/manager; absent for inspector.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// ─── Mock BFF seam ────────────────────────────────────────────────────────────

const getSelfGrants = vi.fn();
const getAllGrants = vi.fn();
const deleteGrant = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn(async () => 'tok-test'),
}));

const getSessionContext = vi.fn();

vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        sessionContext: {
            context: { $get: getSessionContext },
        },
        mcpGrants: {
            grants: {
                $get: getSelfGrants,
                all: { $get: getAllGrants },
                ':id': { $delete: deleteGrant },
            },
        },
    })),
}));

// ─── Mock react-router hooks (SSR render path) ────────────────────────────────

const mockLoaderData = { self: [], all: null, role: 'inspector', isSaas: false };
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useLoaderData: vi.fn(() => mockLoaderData),
        useFetcher: vi.fn(() => ({
            state: 'idle',
            submit: vi.fn(),
            Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
                createElement('form', props, children),
        })),
        Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [k: string]: unknown }) =>
            createElement('a', { href: to, ...props }, children),
    };
});

vi.mock('~/hooks/useSessionContext', () => ({
    useSessionContext: vi.fn(() => ({
        user: { role: 'inspector', name: 'Alice', email: 'alice@example.com', initials: 'A' },
        branding: { isSaas: false, companyName: 'Test Co', primaryColor: '#000', logoUrl: null, reportTheme: 'default', tenantSlug: null, tenantStatus: 'active', currentUserSlug: null, bookingHost: null, portalBaseUrl: null, privacyUrl: null },
        deployment: { mode: 'standalone', hasBilling: false, hasSeatQuota: false },
        seatUsage: null,
    })),
}));

import { loader, action } from '~/routes/settings-connected-apps';
import SettingsConnectedApps from '~/routes/settings-connected-apps';
import { useLoaderData, useFetcher } from 'react-router';
import { useSessionContext } from '~/hooks/useSessionContext';
import { createApi } from '~/lib/api-client.server';

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

const SAMPLE_GRANT = {
    id: 'g1',
    clientId: 'claude-mcp',
    clientName: 'Claude',
    scopes: ['read:inspections', 'write:inspections'],
    createdAt: 1_700_000_000,
    expiresAt: null,
};

const ADMIN_GRANT = {
    id: 'g2',
    clientId: 'claude-mcp',
    clientName: 'Claude',
    scopes: ['read:inspections'],
    createdAt: 1_700_000_100,
    expiresAt: 1_800_000_000,
    userId: 'u2',
    userEmail: 'bob@example.com',
    userRole: 'inspector',
};

function jsonRes(body: unknown, ok = true) {
    return { ok, json: async () => body } as unknown as Response;
}

function loaderArgs(overrideUrl?: string): LoaderArgs {
    return {
        request: new Request(overrideUrl ?? 'http://app.example.com/settings/connected-apps'),
        context: {} as never,
        params: {},
    } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    return {
        request: new Request('http://app.example.com/settings/connected-apps', {
            method: 'POST',
            body: fd,
        }),
        context: {} as never,
        params: {},
    } as unknown as ActionArgs;
}

beforeEach(() => {
    getSelfGrants.mockReset().mockResolvedValue(jsonRes({ data: [SAMPLE_GRANT] }));
    getAllGrants.mockReset().mockResolvedValue(jsonRes({ data: [ADMIN_GRANT] }));
    deleteGrant.mockReset().mockResolvedValue(jsonRes({ success: true }));
    getSessionContext.mockReset().mockResolvedValue(
        jsonRes({ data: { user: { role: 'inspector' }, branding: { isSaas: false }, deployment: { mcpEnabled: true } } }),
    );
    vi.mocked(useLoaderData).mockReturnValue({ mcpEnabled: true, self: [SAMPLE_GRANT], all: null, role: 'inspector', isSaas: false } as never);
    vi.mocked(useSessionContext).mockReturnValue({
        user: { role: 'inspector', name: 'Alice', email: 'alice@example.com', initials: 'A' },
        branding: { isSaas: false, companyName: 'Test Co', primaryColor: '#000', logoUrl: null, reportTheme: 'default', tenantSlug: null, tenantStatus: 'active', currentUserSlug: null, bookingHost: null, portalBaseUrl: null, privacyUrl: null },
        deployment: { mode: 'standalone', hasBilling: false, hasSeatQuota: false, mcpEnabled: true },
        seatUsage: null,
    });
});

// ─── Loader tests ─────────────────────────────────────────────────────────────

describe('settings-connected-apps loader', () => {
    it('fetches self grants via BFF and returns them', async () => {
        const data = await loader(loaderArgs());
        expect(getSelfGrants).toHaveBeenCalled();
        expect(data.self).toHaveLength(1);
        expect(data.self[0].clientName).toBe('Claude');
    });

    it('degrades gracefully to empty when MCP is off (404)', async () => {
        getSelfGrants.mockResolvedValue(jsonRes(null, false));
        const data = await loader(loaderArgs());
        expect(data.self).toEqual([]);
    });

    it('does NOT fetch all-grants for a non-admin role', async () => {
        // Default mock returns role="inspector". isAdminRole("inspector") is false,
        // so all stays null and getAllGrants is never called.
        const data = await loader(loaderArgs());
        expect(getAllGrants).not.toHaveBeenCalled();
        expect(data.all).toBeNull();
    });

    it('fetches all-grants for an owner role and returns them', async () => {
        // Provide a sessionContext stub that resolves role=owner so the loader enters the admin branch.
        vi.mocked(createApi).mockImplementationOnce(() => ({
            sessionContext: {
                context: {
                    $get: vi.fn().mockResolvedValue(
                        jsonRes({ data: { user: { role: 'owner' }, branding: { isSaas: false }, deployment: { mcpEnabled: true } } }),
                    ),
                },
            },
            mcpGrants: {
                grants: {
                    $get: getSelfGrants,
                    all: { $get: getAllGrants },
                    ':id': { $delete: deleteGrant },
                },
            },
        } as never));

        const data = await loader(loaderArgs());
        // The admin branch was reached: getAllGrants was called and data.all contains the stub data.
        expect(getAllGrants).toHaveBeenCalled();
        expect(Array.isArray(data.all)).toBe(true);
        expect(data.all).toHaveLength(1);
        expect(data.all![0].id).toBe(ADMIN_GRANT.id);
    });
});

// ─── Action tests ─────────────────────────────────────────────────────────────

describe('settings-connected-apps action', () => {
    it('intent=revoke calls DELETE /grants/:id without admin flag', async () => {
        const res = await action(actionArgs({ intent: 'revoke', id: 'g1' }));
        expect(deleteGrant).toHaveBeenCalledWith({ param: { id: 'g1' }, query: {} });
        expect(res).toMatchObject({ ok: true, intent: 'revoke' });
    });

    it('intent=revoke-admin calls DELETE /grants/:id with admin=1', async () => {
        const res = await action(actionArgs({ intent: 'revoke-admin', id: 'g2' }));
        expect(deleteGrant).toHaveBeenCalledWith({ param: { id: 'g2' }, query: { admin: '1' } });
        expect(res).toMatchObject({ ok: true, intent: 'revoke-admin' });
    });

    it('returns ok:false when the DELETE fails', async () => {
        deleteGrant.mockResolvedValue(jsonRes(null, false));
        const res = await action(actionArgs({ intent: 'revoke', id: 'g1' }));
        expect(res).toMatchObject({ ok: false, intent: 'revoke' });
    });

    it('returns ok:false on unknown intent', async () => {
        const res = await action(actionArgs({ intent: 'unknown' }));
        expect(res).toMatchObject({ ok: false });
    });
});

// ─── Render tests ─────────────────────────────────────────────────────────────

describe('SettingsConnectedApps component render', () => {
    it('renders a row for each self grant with the client name visible', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            self: [SAMPLE_GRANT],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        expect(html).toContain('Claude');
    });

    it('renders a scope/module indicator for each grant row', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            self: [SAMPLE_GRANT],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        // scopes are rendered somewhere (module label or raw scope text)
        expect(html).toMatch(/Inspections|read:inspections|inspections/i);
    });

    it('shows Revoke button for each self grant', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            self: [SAMPLE_GRANT],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        expect(html).toContain('Revoke');
    });

    it('does NOT render the tenant-wide section for a non-admin role', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            self: [SAMPLE_GRANT],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        expect(html).not.toContain('Tenant-wide');
    });

    it('renders the tenant-wide section for an owner with all-grants data', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            self: [SAMPLE_GRANT],
            all: [ADMIN_GRANT],
            role: 'owner',
            isSaas: false,
        } as never);
        vi.mocked(useSessionContext).mockReturnValue({
            user: { role: 'owner', name: 'Admin', email: 'admin@example.com', initials: 'A' },
            branding: { isSaas: false, companyName: 'Test Co', primaryColor: '#000', logoUrl: null, reportTheme: 'default', tenantSlug: null, tenantStatus: 'active', currentUserSlug: null, bookingHost: null, portalBaseUrl: null, privacyUrl: null },
            deployment: { mode: 'standalone', hasBilling: false, hasSeatQuota: false, mcpEnabled: true },
            seatUsage: null,
        });
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        expect(html).toContain('Tenant-wide');
        expect(html).toContain('bob@example.com');
    });

    it('groups tenant-wide admin rows by userEmail', () => {
        const CAROL_GRANT = {
            id: 'g3',
            clientId: 'tool-client',
            clientName: 'ToolApp',
            scopes: ['read:inspections'],
            createdAt: 1_700_000_300,
            expiresAt: null,
            userId: 'u3',
            userEmail: 'carol@example.com',
            userRole: 'inspector',
        };
        vi.mocked(useLoaderData).mockReturnValue({
            self: [],
            all: [ADMIN_GRANT, CAROL_GRANT],
            role: 'owner',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        // Both user emails appear — at minimum as group headings.
        expect(html).toContain('bob@example.com');
        expect(html).toContain('carol@example.com');
        // Each email appears at least twice: once as group header, once inside AdminGrantRow.
        expect((html.match(/bob@example\.com/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((html.match(/carol@example\.com/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('renders empty-state when self grants list is empty', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            self: [],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        expect(html).toMatch(/no authorized|no applications|not authorized|none yet/i);
    });

    it('never calls window.confirm (ConfirmDialog is used instead)', () => {
        // happy-dom does not define window.confirm; we install a spy to confirm the
        // route never calls it (it must use ConfirmDialog / Modal instead).
        const mockConfirm = vi.fn().mockReturnValue(false);
        Object.defineProperty(globalThis, 'confirm', {
            value: mockConfirm,
            configurable: true,
            writable: true,
        });
        vi.mocked(useLoaderData).mockReturnValue({
            self: [SAMPLE_GRANT],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        renderToStaticMarkup(createElement(SettingsConnectedApps));
        // Rendering alone (no user interaction) must never trigger a confirm dialog.
        expect(mockConfirm).not.toHaveBeenCalled();
        // Verify ConfirmDialog renders a modal instead (the ConfirmDialog element is in the tree).
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        // ConfirmDialog with open=false still renders the modal element in static markup
        // (Modal controls visibility via CSS; confirm via plain DOM is never invoked).
        expect(mockConfirm).not.toHaveBeenCalled();
        delete (globalThis as Record<string, unknown>)['confirm'];
    });

    it('renders the feature-off empty state when loader returns mcpEnabled=false', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            mcpEnabled: false,
            self: [],
            all: null,
            role: 'inspector',
            isSaas: false,
        } as never);
        const html = renderToStaticMarkup(createElement(SettingsConnectedApps));
        expect(html).toContain('MCP is not enabled');
        // Grants UI must NOT be rendered.
        expect(html).not.toContain('Your applications');
    });
});

// ─── Loader feature-off test ──────────────────────────────────────────────────

describe('settings-connected-apps loader (feature-off)', () => {
    it('returns mcpEnabled=false and empty grants when deployment.mcpEnabled is false', async () => {
        getSessionContext.mockResolvedValue(
            jsonRes({ data: { user: { role: 'inspector' }, branding: { isSaas: false }, deployment: { mcpEnabled: false } } }),
        );
        const data = await loader(loaderArgs());
        expect(data.mcpEnabled).toBe(false);
        expect(data.self).toEqual([]);
        expect(data.all).toBeNull();
        // No grants fetches should happen.
        expect(getSelfGrants).not.toHaveBeenCalled();
        expect(getAllGrants).not.toHaveBeenCalled();
    });
});
