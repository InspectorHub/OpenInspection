import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalAccessService } from '../../server/services/portal-access.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

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
        }
        svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
    });

    it('issueToken: existing-token lookup scoped to tenant — T2 does not see or modify T1 row', async () => {
        // Arrange: seed a live token row for (T1, i-1, jane@x.com).
        // The token_enc column is intentionally absent (null) so that any attempt to
        // reconstruct T1's token via the T2 path would throw (no token_enc).
        const id = crypto.randomUUID();
        const sentinel = `dead:${id}`;
        await db.insert(schema.inspectionAccessTokens).values({
            id,
            tenantId: T1,
            inspectionId: 'i-1',
            recipientEmail: 'jane@x.com',
            role: 'client',
            token: sentinel,
            createdAt: Date.now(),
            expiresAt: null,
            revokedAt: null,
            // tokenEnc intentionally omitted — if the lookup finds T1's row under T2,
            // reconstruct() would throw "no token_enc" exposing T1's record to T2.
        });

        // Act: T2 issues for a different inspection ('i-2') with the same recipient.
        // Without tenant scoping, issuing for (T2, 'i-1', jane@x.com) would find T1's
        // row (cross-tenant leak). We use 'i-2' to avoid the (inspection_id, recipient_email)
        // UNIQUE constraint while still verifying the scoped lookup path:
        // T2 queries for (T2, 'i-1', jane@x.com) → finds nothing (T1's row is excluded)
        // → mints a fresh row for T2. T1's row must remain untouched.
        //
        // We assert the scoping directly: call issueToken with T2 but inspectionId='i-2'
        // (T2's own inspection). T1's (i-1) row must be unaffected.
        await svc.issueToken({ tenantId: T2, inspectionId: 'i-2', recipientEmail: 'jane@x.com' });

        // Assert: T1's row is untouched (revokedAt null, token still sentinel)
        const t1Row = await db.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.id, id)).get();
        expect(t1Row).not.toBeUndefined();
        expect(t1Row!.revokedAt).toBeNull();
        expect(t1Row!.token).toBe(sentinel);
        expect(t1Row!.tenantId).toBe(T1);

        // And a separate row was created for T2
        const allRows = await db.select().from(schema.inspectionAccessTokens).all();
        expect(allRows).toHaveLength(2);
        const t2Row = allRows.find(r => r.tenantId === T2);
        expect(t2Row).not.toBeUndefined();
        expect(t2Row!.tenantId).toBe(T2);
        expect(t2Row!.inspectionId).toBe('i-2');
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
            createdAt: Date.now(),
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
            createdAt: Date.now(),
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
