import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resolvePortalAccess } from '../../server/lib/public-access';
import { PortalAccessService } from '../../server/services/portal-access.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { hashToken, deadTokenSentinel } from '../../server/lib/token-hash';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const live = { inspectionId: 'insp1', tenantId: 't1', role: 'client' as const, recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null };

describe('resolvePortalAccess', () => {
    it('null when no token', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => live }, undefined, 'insp1')).toBeNull();
    });
    it('null when token unknown', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => null }, 'x', 'insp1')).toBeNull();
    });
    it('null when token maps to a different inspection', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => ({ ...live, inspectionId: 'other' }) }, 'x', 'insp1')).toBeNull();
    });
    it('null when revoked', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => ({ ...live, revokedAt: 1 }) }, 'x', 'insp1')).toBeNull();
    });
    it('null when expired', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => ({ ...live, expiresAt: 1 }) }, 'x', 'insp1', 2)).toBeNull();
    });
    it('returns {tenantId, role, recipientEmail} when live + matching', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => live }, 'x', 'insp1', 0)).toEqual({
            tenantId: 't1', role: 'client', recipientEmail: 'a@b.com',
        });
    });
});

// ─── Track I-a — hash-at-rest (tier-2) ───────────────────────────────────────
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const INSPECTION = '11111111-1111-1111-1111-1111111111c1';
const JWT = 'unit-test-jwt-secret';

describe('PortalAccessService — token hash-at-rest (tier-2)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: PortalAccessService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
    });

    it('(a) issueToken stores hash + enc, NOT plaintext (legacy column is a sentinel)', async () => {
        const token = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        const rows = await testDb.select().from(schema.inspectionAccessTokens).all();
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.token).toBe(deadTokenSentinel(row.id));
        expect(row.token).not.toBe(token);
        expect(row.tokenHash).toBe(await hashToken(token));
        expect(row.tokenEnc).toMatch(/^t1:/);
    });

    it('(b) presenting the plaintext resolves via the hash path', async () => {
        const token = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        const grant = await svc.resolveToken(token);
        expect(grant).not.toBeNull();
        expect(grant?.tenantId).toBe(TENANT);
        expect(grant?.inspectionId).toBe(INSPECTION);
        expect(grant?.recipientEmail).toBe('c@x.com');
    });

    it('(d) re-issue reconstructs the SAME plaintext (stable link) for a hashed row', async () => {
        const first = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        const again = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        expect(again).toBe(first);
        // Only ever one row for the (inspection, recipient) pair.
        const rows = await testDb.select().from(schema.inspectionAccessTokens).all();
        expect(rows).toHaveLength(1);
    });

    it('(c) legacy plaintext row resolves AND is upgraded in place (+ enc seeded)', async () => {
        const legacyToken = 'legacy-portal-plaintext-token-123456';
        const id = crypto.randomUUID();
        await testDb.insert(schema.inspectionAccessTokens).values({
            id, tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'old@x.com',
            role: 'client', token: legacyToken, createdAt: Date.now(),
            expiresAt: null, revokedAt: null,
        });
        const grant = await svc.resolveToken(legacyToken);
        expect(grant?.recipientEmail).toBe('old@x.com');
        const row = await testDb.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, id)).get();
        expect(row?.tokenHash).toBe(await hashToken(legacyToken));
        expect(row?.token).toBe(deadTokenSentinel(id));
        expect(row?.tokenEnc).toMatch(/^t1:/);
    });

    it('(d) re-issue reconstructs the original plaintext for an upgraded legacy row', async () => {
        const legacyToken = 'legacy-portal-plaintext-token-abcdef';
        const id = crypto.randomUUID();
        await testDb.insert(schema.inspectionAccessTokens).values({
            id, tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'old@x.com',
            role: 'client', token: legacyToken, createdAt: Date.now(),
            expiresAt: null, revokedAt: null,
        });
        await svc.resolveToken(legacyToken); // triggers upgrade + enc seal
        const reissued = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'old@x.com' });
        expect(reissued).toBe(legacyToken);
    });

    it('revoked row re-issue rotates to a fresh token (resolves, old does not)', async () => {
        const first = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        await svc.revokeForRecipient(INSPECTION, 'c@x.com');
        const second = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        expect(second).not.toBe(first);
        expect(await svc.resolveToken(second)).not.toBeNull();
        expect(await svc.resolveToken(first)).toBeNull();
    });
});
