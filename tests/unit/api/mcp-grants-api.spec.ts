/**
 * Integration tests for the MCP grant-management API.
 *
 * Harness: fresh OpenAPIHono app per test with a mocked OAUTH_PROVIDER
 * injected into env, and services.admin stubbed via a middleware-injected
 * context variable. `auditFromContext` is module-mocked so the fire-and-
 * forget write is observable without a real D1 database.
 *
 * Assertions:
 * (a) self-list returns ONLY the caller's grants (not other users')
 * (b) self-revoke calls revokeGrant(id, caller.sub) and records audit
 * (c) self-revoke of an id NOT owned by caller → 404
 * (d) admin-list (GET /grants/all) returns tenant-member grants with userEmail
 * (e) non-admin hitting /grants/all or DELETE …?admin=1 → 403
 * (f) admin revoke of a grant id from another tenant → 404 (cross-tenant guard)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import mcpGrantsRouter from '../../../server/api/mcp-grants';

// ─── Module mocks (hoisted by Vitest) ──────────────────────────────────────

// Mock auditFromContext so no real D1 write happens and we can assert calls.
vi.mock('../../../server/lib/audit', () => ({
    auditFromContext: vi.fn(),
    writeAuditLog: vi.fn(),
}));

import { auditFromContext } from '../../../server/lib/audit';
const mockAudit = vi.mocked(auditFromContext);

// ─── Test fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-abc-123';
const CALLER_ID = 'user-caller-001';
const MEMBER_ID = 'user-member-002';

/** Grant owned by the caller */
const GRANT_CALLER = {
    id: 'grant-caller-1',
    clientId: 'client-mcp-claude',
    userId: CALLER_ID,
    scope: ['read', 'write'],
    metadata: { clientName: 'Claude Desktop' },
    createdAt: 1700000000,
    expiresAt: undefined,
};

/** Grant owned by a different tenant member */
const GRANT_MEMBER = {
    id: 'grant-member-1',
    clientId: 'client-mcp-other',
    userId: MEMBER_ID,
    scope: ['read'],
    metadata: { clientName: 'Other MCP' },
    createdAt: 1700000001,
    expiresAt: undefined,
};

/** Tenant members returned by adminService.getMembers */
const MEMBERS = [
    { id: CALLER_ID, email: 'caller@test.com', role: 'manager', createdAt: new Date() },
    { id: MEMBER_ID, email: 'member@test.com', role: 'inspector', createdAt: new Date() },
];

// ─── App builder ────────────────────────────────────────────────────────────

function makeOAuthProvider(opts: {
    callerGrants?: typeof GRANT_CALLER[];
    memberGrants?: typeof GRANT_MEMBER[];
} = {}) {
    const { callerGrants = [GRANT_CALLER], memberGrants = [GRANT_MEMBER] } = opts;
    const userGrantMap: Record<string, unknown[]> = {
        [CALLER_ID]: callerGrants,
        [MEMBER_ID]: memberGrants,
    };
    return {
        listUserGrants: vi.fn(async (userId: string) => ({ items: userGrantMap[userId] ?? [] })),
        revokeGrant: vi.fn(async (_grantId: string, _userId: string) => {}),
    };
}

function buildApp(opts: {
    userRole?: string;
    userId?: string;
    mcpEnabled?: boolean;
    oauthProvider?: ReturnType<typeof makeOAuthProvider>;
    getMembersImpl?: () => Promise<{ members: typeof MEMBERS; invites: unknown[] }>;
} = {}) {
    const {
        userRole = 'manager',
        userId = CALLER_ID,
        mcpEnabled = true,
        oauthProvider = makeOAuthProvider(),
        getMembersImpl = async () => ({ members: MEMBERS, invites: [] }),
    } = opts;

    const app = new OpenAPIHono<HonoConfig>();

    // Error handler converts AppError (thrown by requireRole middleware) to JSON.
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json(
                { success: false as const, error: { code: err.code, message: err.message } },
                err.status,
            );
        }
        return c.json(
            { success: false as const, error: { code: 'internal_error', message: String(err) } },
            500,
        );
    });

    app.use('*', async (c, next) => {
        c.env = {
            MCP_ENABLED: mcpEnabled ? 'true' : 'false',
            OAUTH_PROVIDER: oauthProvider,
            DB: {},
        } as unknown as HonoConfig['Bindings'];
        c.set('user', { sub: userId, role: userRole as HonoConfig['Variables']['user']['role'] });
        c.set('tenantId', TENANT_ID);
        c.set('userRole', userRole as HonoConfig['Variables']['userRole']);
        c.set('services', {
            admin: { getMembers: vi.fn(getMembersImpl) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/api/mcp', mcpGrantsRouter);
    return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/mcp/grants (self list)', () => {
    beforeEach(() => { mockAudit.mockClear(); });

    it('(a) returns only the caller\'s own grants', async () => {
        const app = buildApp();
        const res = await app.request('/api/mcp/grants', { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ id: string; clientName: string; scopes: string[] }> };
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({
            id: 'grant-caller-1',
            clientName: 'Claude Desktop',
            scopes: ['read', 'write'],
        });
    });

    it('returns 404 when MCP feature flag is disabled', async () => {
        const app = buildApp({ mcpEnabled: false });
        const res = await app.request('/api/mcp/grants', { method: 'GET' });
        expect(res.status).toBe(404);
    });

    it('maps clientName from grant metadata', async () => {
        const app = buildApp({
            oauthProvider: makeOAuthProvider({
                callerGrants: [{ ...GRANT_CALLER, metadata: { clientName: 'Custom MCP' } }],
            }),
        });
        const res = await app.request('/api/mcp/grants', { method: 'GET' });
        const body = await res.json() as { data: Array<{ clientName: string }> };
        expect(body.data[0].clientName).toBe('Custom MCP');
    });

    it('returns null clientName when metadata lacks clientName', async () => {
        const app = buildApp({
            oauthProvider: makeOAuthProvider({ callerGrants: [{ ...GRANT_CALLER, metadata: null }] }),
        });
        const res = await app.request('/api/mcp/grants', { method: 'GET' });
        const body = await res.json() as { data: Array<{ clientName: string | null }> };
        expect(body.data[0].clientName).toBeNull();
    });
});

describe('DELETE /api/mcp/grants/:id (self revoke)', () => {
    beforeEach(() => { mockAudit.mockClear(); });

    it('(b) revokes own grant and records mcp.grant.revoked audit', async () => {
        const mockProvider = makeOAuthProvider();
        const app = buildApp({ oauthProvider: mockProvider });
        const res = await app.request('/api/mcp/grants/grant-caller-1', { method: 'DELETE' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // revokeGrant must be called with (grantId, caller.sub)
        expect(mockProvider.revokeGrant).toHaveBeenCalledWith('grant-caller-1', CALLER_ID);
        // Audit must be written with the correct action + entityId
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            'mcp.grant.revoked',
            'mcp_grant',
            expect.objectContaining({ entityId: 'grant-caller-1' }),
        );
    });

    it('(c) returns 404 for an id NOT in the caller\'s own grants', async () => {
        const mockProvider = makeOAuthProvider();
        const app = buildApp({ oauthProvider: mockProvider });
        // 'grant-member-1' is owned by MEMBER_ID, not CALLER_ID
        const res = await app.request('/api/mcp/grants/grant-member-1', { method: 'DELETE' });
        expect(res.status).toBe(404);
        // revokeGrant must NOT have been called
        expect(mockProvider.revokeGrant).not.toHaveBeenCalled();
    });

    it('returns 404 when MCP is disabled', async () => {
        const app = buildApp({ mcpEnabled: false });
        const res = await app.request('/api/mcp/grants/grant-caller-1', { method: 'DELETE' });
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/mcp/grants/:id?admin=1 (admin revoke)', () => {
    beforeEach(() => { mockAudit.mockClear(); });

    it('owner can revoke a grant owned by another tenant member', async () => {
        const mockProvider = makeOAuthProvider();
        const app = buildApp({ userRole: 'owner', oauthProvider: mockProvider });
        const res = await app.request('/api/mcp/grants/grant-member-1?admin=1', { method: 'DELETE' });
        expect(res.status).toBe(200);
        // Must revoke with the grant's actual owner userId, not the caller's
        expect(mockProvider.revokeGrant).toHaveBeenCalledWith('grant-member-1', MEMBER_ID);
        // Audit must include admin=true and targetUserId
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            'mcp.grant.revoked',
            'mcp_grant',
            expect.objectContaining({
                entityId: 'grant-member-1',
                metadata: expect.objectContaining({ admin: true, targetUserId: MEMBER_ID }),
            }),
        );
    });

    it('manager can also use the admin path', async () => {
        const mockProvider = makeOAuthProvider();
        const app = buildApp({ userRole: 'manager', oauthProvider: mockProvider });
        const res = await app.request('/api/mcp/grants/grant-member-1?admin=1', { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(mockProvider.revokeGrant).toHaveBeenCalledWith('grant-member-1', MEMBER_ID);
    });

    it('(e) inspector role hitting ?admin=1 → 403 (inline role check)', async () => {
        const app = buildApp({ userRole: 'inspector' });
        const res = await app.request('/api/mcp/grants/grant-member-1?admin=1', { method: 'DELETE' });
        expect(res.status).toBe(403);
    });

    it('(f) admin revoke of a grant NOT in this tenant → 404 (cross-tenant guard)', async () => {
        // Both tenant members have no grants → a foreign grant-id returns 404
        const mockProvider = makeOAuthProvider({ callerGrants: [], memberGrants: [] });
        const app = buildApp({ userRole: 'manager', oauthProvider: mockProvider });
        const res = await app.request('/api/mcp/grants/grant-foreign-xyz?admin=1', { method: 'DELETE' });
        expect(res.status).toBe(404);
        expect(mockProvider.revokeGrant).not.toHaveBeenCalled();
    });
});

describe('GET /api/mcp/grants/all (admin list)', () => {
    beforeEach(() => { mockAudit.mockClear(); });

    it('(d) owner gets all tenant member grants with userEmail', async () => {
        const app = buildApp({ userRole: 'owner' });
        const res = await app.request('/api/mcp/grants/all', { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ id: string; userEmail?: string; userRole?: string }> };
        expect(body.data.length).toBeGreaterThanOrEqual(1);
        // Every grant must have userEmail (admin view)
        for (const g of body.data) {
            expect(g.userEmail).toBeTruthy();
            expect(g.userRole).toBeTruthy();
        }
    });

    it('manager can also list all grants', async () => {
        const app = buildApp({ userRole: 'manager' });
        const res = await app.request('/api/mcp/grants/all', { method: 'GET' });
        expect(res.status).toBe(200);
    });

    it('(e) inspector role hitting /grants/all → 403', async () => {
        const app = buildApp({ userRole: 'inspector' });
        const res = await app.request('/api/mcp/grants/all', { method: 'GET' });
        expect(res.status).toBe(403);
    });

    it('returns grants from ALL tenant members (not just the caller)', async () => {
        const app = buildApp({ userRole: 'owner' });
        const res = await app.request('/api/mcp/grants/all', { method: 'GET' });
        const body = await res.json() as { data: Array<{ id: string }> };
        const ids = body.data.map((g) => g.id);
        expect(ids).toContain('grant-caller-1');
        expect(ids).toContain('grant-member-1');
    });

    it('returns 404 when MCP is disabled', async () => {
        const app = buildApp({ userRole: 'owner', mcpEnabled: false });
        const res = await app.request('/api/mcp/grants/all', { method: 'GET' });
        expect(res.status).toBe(404);
    });
});
