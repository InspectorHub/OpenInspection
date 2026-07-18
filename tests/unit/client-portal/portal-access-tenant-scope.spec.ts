import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { sealToken } from '../../../server/lib/config-crypto';
import { mintToken, hashToken, deadTokenSentinel } from '../../../server/lib/token-hash';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';
const JWT = 'unit-test-jwt-secret';

describe('PortalAccessService tenant scoping', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: PortalAccessService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        for (const t of [T1, T2]) {
            await db.insert(schema.tenants).values({
                id: t, name: t, slug: t, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
            // issueToken validates `role` against the tenant's active role
            // profiles — seed both tenants so the 'client' role used below
            // resolves and the UNIQUE-constraint discriminator (not role
            // validation) is what the cross-tenant test exercises.
            await seedRoleProfiles(db, t);
        }
        svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
    });

    it('issueToken: existing-token lookup scoped to tenant — T2 cannot reuse T1 row for same inspection', async () => {
        // Arrange: seed a live token row for (T1, i-1, jane@x.com) with a valid tokenEnc.
        //
        // Why tokenEnc must be set: reconstruct() tries the legacy plaintext column first
        // (skipped because token = sentinel), then opens tokenEnc. Without tokenEnc the
        // no-predicate path would also throw ("no token_enc") — both paths would throw and
        // the test would be non-discriminating. With tokenEnc set, the no-predicate path
        // succeeds: it finds T1's row and returns T1's plaintext token. This is the
        // cross-tenant data-leak the predicate guards against.
        //
        // Discriminator:
        //   WITH    eq(tenantId) predicate → T2 lookup misses T1's row → INSERT
        //           (T2, 'i-1', jane@x.com) → UNIQUE(inspection_id, recipient_email)
        //           violation → rejects/throws.
        //   WITHOUT eq(tenantId) predicate → T2 lookup finds T1's row (revokedAt=null)
        //           → reconstruct() succeeds → RETURNS T1's plaintext token (no throw).
        // Removing the predicate flips rejects → resolves-with-T1-token.
        const t1PlaintextToken = mintToken();
        const t1TokenHash = await hashToken(t1PlaintextToken);
        const t1TokenEnc = await sealToken(t1PlaintextToken, T1, JWT);
        const id = crypto.randomUUID();
        await db.insert(schema.inspectionAccessTokens).values({
            id,
            tenantId: T1,
            inspectionId: 'i-1',
            recipientEmail: 'jane@x.com',
            role: 'client',
            token: deadTokenSentinel(id),
            tokenHash: t1TokenHash,
            tokenEnc: t1TokenEnc,
            createdAt: new Date(),
            expiresAt: null,
            revokedAt: null,
        });

        // Act: T2 issues a token for the SAME (inspectionId='i-1', recipientEmail='jane@x.com').
        // With the tenant predicate the lookup finds nothing for T2, so issueToken tries to
        // INSERT — hitting the UNIQUE(inspection_id, recipient_email) constraint → throws.
        // Without the predicate it would find T1's row, reconstruct it, and RETURN T1's token.
        await expect(
            svc.issueToken({ tenantId: T2, inspectionId: 'i-1', recipientEmail: 'jane@x.com' }),
        ).rejects.toThrow();

        // Assert: T1's row is completely untouched — no side-effect from the T2 attempt.
        const t1Row = await db.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, id)).get();
        expect(t1Row).not.toBeUndefined();
        expect(t1Row!.tenantId).toBe(T1);
        expect(t1Row!.revokedAt).toBeNull();
        expect(t1Row!.tokenHash).toBe(t1TokenHash);
        // Only T1's row exists — no partial T2 row was committed.
        const allRows = await db.select().from(schema.inspectionAccessTokens).all();
        expect(allRows).toHaveLength(1);
    });

    it('revokeForRecipient: T2 revoke does not affect T1 row', async () => {
        // Arrange: seed a live token row for (T1, i-1, jane@x.com)
        const id = crypto.randomUUID();
        await db.insert(schema.inspectionAccessTokens).values({
            id,
            tenantId: T1,
            inspectionId: 'i-1',
            recipientEmail: 'jane@x.com',
            role: 'client',
            token: `dead:${id}`,
            createdAt: new Date(),
            expiresAt: null,
            revokedAt: null,
        });

        // Act: revoke using T2
        await svc.revokeForRecipient(T2, 'i-1', 'jane@x.com');

        // Assert: T1's row is untouched
        const row = await db.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, id)).get();
        expect(row!.revokedAt).toBeNull();
    });

    it('setExpiryForInspection: T2 expiry does not affect T1 row', async () => {
        // Arrange: seed a live token row for (T1, i-1, jane@x.com)
        const id = crypto.randomUUID();
        await db.insert(schema.inspectionAccessTokens).values({
            id,
            tenantId: T1,
            inspectionId: 'i-1',
            recipientEmail: 'jane@x.com',
            role: 'client',
            token: `dead:${id}`,
            createdAt: new Date(),
            expiresAt: null,
            revokedAt: null,
        });

        // Act: set expiry using T2
        const expiry = Date.now() + 1000 * 60 * 60 * 24 * 30;
        await svc.setExpiryForInspection(T2, 'i-1', expiry);

        // Assert: T1's row expiresAt is still null
        const row = await db.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, id)).get();
        expect(row!.expiresAt).toBeNull();
    });
});
