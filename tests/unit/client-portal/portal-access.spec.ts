import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resolvePortalAccess } from '../../../server/lib/public-access';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { hashToken } from '../../../server/lib/token-hash';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const live = { id: 'tok1', inspectionId: 'insp1', tenantId: 't1', role: 'client' as const, recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null };

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
    // The grant carries `accessTokenId` too (public-access.ts:66). The fixture
    // used to omit `id`, so that key came back `undefined` and `toEqual` skipped
    // it — the case named three fields and checked three of four. A real row
    // always has an id, so the fourth is now asserted.
    it('returns {accessTokenId, tenantId, role, recipientEmail} when live + matching', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => live }, 'x', 'insp1', 0)).toEqual({
            accessTokenId: 'tok1', tenantId: 't1', role: 'client', recipientEmail: 'a@b.com',
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
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // issueToken validates `role` against the tenant's active role
        // profiles — seed the defaults so the (unqualified) 'client' role
        // used throughout this suite resolves.
        await seedRoleProfiles(asD1Db(testDb), TENANT);
        svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
    });

    it('(a) issueToken stores hash + enc, and the row holds no plaintext at all', async () => {
        const token = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        const rows = await testDb.select().from(schema.inspectionAccessTokens).all();
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.tokenHash).toBe(await hashToken(token));
        expect(row.tokenEnc).toMatch(/^t1:/);
        // This used to assert the plaintext column equalled a sentinel, because
        // it was NOT NULL + UNIQUE and had to hold something. The column is gone,
        // so the assertion can be the one that was always meant: the emitted
        // token appears nowhere in the stored row.
        expect(JSON.stringify(row)).not.toContain(token);
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

    // (c) and (d) covered the legacy plaintext row: resolve one, upgrade it in
    // place, and re-issue the ORIGINAL link afterwards. Both the column and the
    // upgrade are gone. Production had no such row left — every one of the two
    // live grants carried a hash — so the branch could only ever miss, and a
    // spec that constructs the row by hand would be testing a state the schema
    // can no longer represent.
    //
    // A token that resolves to nothing is still covered, below and in (b).

    it('an unknown token resolves to nothing', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        expect(await svc.resolveToken('not-a-token-anyone-issued')).toBeNull();
    });

    it('revoked row re-issue rotates to a fresh token (resolves, old does not)', async () => {
        const first = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        await svc.revokeForRecipient(TENANT, INSPECTION, 'c@x.com');
        const second = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'c@x.com' });
        expect(second).not.toBe(first);
        expect(await svc.resolveToken(second)).not.toBeNull();
        expect(await svc.resolveToken(first)).toBeNull();
    });
});
