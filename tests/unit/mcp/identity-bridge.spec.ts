import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppEnv } from '../../../server/types/hono';

// isGrantUserActive routes drizzle(env.DB) to the in-memory SQLite test DB
// (the established pattern in this suite — see team-remove-softdelete.spec.ts).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import {
    internalJwtPayload,
    assertCompanySlugMatches,
    companySlugFromMcpPath,
    stripCompanyPrefix,
    isGrantUserActive,
} from '../../../server/lib/mcp/identity-bridge';
import type { McpProps } from '../../../server/durable-objects/inspector-mcp';

const sample: McpProps = {
    userId: 'u-123',
    tenantId: 't-456',
    tenantSlug: 'acme-inspections',
    role: 'inspector',
    scopes: ['read:inspections'],
};

describe('internalJwtPayload', () => {
    it('emits sub from userId', () => {
        expect(internalJwtPayload(sample).sub).toBe('u-123');
    });

    it('emits custom:userRole (not custom:role or role) from props.role', () => {
        const p = internalJwtPayload(sample);
        expect(p['custom:userRole']).toBe('inspector');
        // Brief correction verified: jwt-claims.ts reads 'custom:userRole', NOT 'custom:role'
        expect(p['custom:role']).toBeUndefined();
        expect(p['role']).toBeUndefined();
    });

    it('emits custom:tenantId from tenantId', () => {
        expect(internalJwtPayload(sample)['custom:tenantId']).toBe('t-456');
    });

    it('includes iat as a recent Unix epoch (seconds)', () => {
        const before = Math.floor(Date.now() / 1000);
        const p = internalJwtPayload(sample);
        const after = Math.floor(Date.now() / 1000);
        expect(typeof p['iat']).toBe('number');
        expect(p['iat'] as number).toBeGreaterThanOrEqual(before);
        expect(p['iat'] as number).toBeLessThanOrEqual(after);
    });

    it('does not leak tenantSlug or scopes into the claim set', () => {
        const p = internalJwtPayload(sample);
        expect(p['tenantSlug']).toBeUndefined();
        expect(p['scopes']).toBeUndefined();
    });

    it('uses props values, not static placeholders', () => {
        const other: McpProps = {
            userId: 'u-999',
            tenantId: 't-888',
            tenantSlug: 'beta',
            role: 'manager',
            scopes: [],
        };
        const p = internalJwtPayload(other);
        expect(p.sub).toBe('u-999');
        expect(p['custom:userRole']).toBe('manager');
        expect(p['custom:tenantId']).toBe('t-888');
    });
});

describe('assertCompanySlugMatches', () => {
    it('returns true when urlSlug matches props.tenantSlug', () => {
        expect(assertCompanySlugMatches('acme-inspections', sample)).toBe(true);
    });

    it('returns false when urlSlug differs from props.tenantSlug', () => {
        expect(assertCompanySlugMatches('other-company', sample)).toBe(false);
    });

    it('is case-sensitive (uppercase slug does not match lowercase tenantSlug)', () => {
        expect(assertCompanySlugMatches('Acme-Inspections', sample)).toBe(false);
    });
});

describe('companySlugFromMcpPath', () => {
    it('extracts slug from /company/{slug}/mcp', () => {
        expect(companySlugFromMcpPath('/company/acme/mcp')).toBe('acme');
    });

    it('returns null for a standalone /mcp path (no company prefix)', () => {
        expect(companySlugFromMcpPath('/mcp')).toBeNull();
    });

    it('extracts slug when path has a trailing slash', () => {
        expect(companySlugFromMcpPath('/company/acme/mcp/')).toBe('acme');
    });

    it('extracts slug when path continues after /mcp/', () => {
        expect(companySlugFromMcpPath('/company/acme/mcp/sse')).toBe('acme');
    });

    it('decodes a percent-encoded slug', () => {
        expect(companySlugFromMcpPath('/company/acme%2Dco/mcp')).toBe('acme-co');
    });

    it('returns null for unrelated paths', () => {
        expect(companySlugFromMcpPath('/api/inspections')).toBeNull();
    });
});

describe('stripCompanyPrefix', () => {
    it('reduces the saas MCP path to the agent mount path', () => {
        // Regression: McpAgent.serve("/mcp") matches the literal mount via
        // URLPattern, so /company/{slug}/mcp must be reduced or it 404s.
        expect(stripCompanyPrefix('/company/acme/mcp')).toBe('/mcp');
    });

    it('preserves any sub-path after /mcp (e.g. legacy SSE /message)', () => {
        expect(stripCompanyPrefix('/company/acme/mcp/message')).toBe('/mcp/message');
    });

    it('handles a slug with encoded characters', () => {
        expect(stripCompanyPrefix('/company/acme%2Dco/mcp')).toBe('/mcp');
    });

    it('leaves a standalone /mcp path unchanged', () => {
        expect(stripCompanyPrefix('/mcp')).toBe('/mcp');
    });

    it('leaves unrelated paths unchanged', () => {
        expect(stripCompanyPrefix('/api/inspections')).toBe('/api/inspections');
    });
});

describe('isGrantUserActive (Fix 1 defense-in-depth)', () => {
    const TENANT = 'tenant-mcp-1';
    const OTHER_TENANT = 'tenant-mcp-2';
    const ACTIVE_USER = 'user-active';
    const REMOVED_USER = 'user-removed';

    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme-mcp', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, name: 'Beta', slug: 'beta-mcp', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.users).values({
            id: ACTIVE_USER, tenantId: TENANT, email: 'active@acme.test', passwordHash: 'x', role: 'inspector', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: REMOVED_USER, tenantId: TENANT, email: 'removed@acme.test', passwordHash: 'x', role: 'inspector',
            createdAt: new Date(), deletedAt: new Date(),
        });
    });

    function propsFor(userId: string, tenantId: string): McpProps {
        return { userId, tenantId, tenantSlug: 'acme-mcp', role: 'inspector', scopes: [] };
    }

    it('returns true for an active user in their own tenant', async () => {
        const active = await isGrantUserActive({} as AppEnv, propsFor(ACTIVE_USER, TENANT));
        expect(active).toBe(true);
    });

    it('returns false for a soft-deleted (removed) user', async () => {
        const active = await isGrantUserActive({} as AppEnv, propsFor(REMOVED_USER, TENANT));
        expect(active).toBe(false);
    });

    it('returns false when the user row does not exist at all', async () => {
        const active = await isGrantUserActive({} as AppEnv, propsFor('user-never-existed', TENANT));
        expect(active).toBe(false);
    });

    it('returns false when the grant tenantId no longer matches the user\'s tenant', async () => {
        // Defense-in-depth also catches a grant whose baked-in tenantId is stale
        // relative to the user row (e.g. cross-tenant tampering scenarios).
        const active = await isGrantUserActive({} as AppEnv, propsFor(ACTIVE_USER, OTHER_TENANT));
        expect(active).toBe(false);
    });
});
