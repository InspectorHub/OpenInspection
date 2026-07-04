import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';

/**
 * DB-2 — partial unique index: (tenant_id, email) WHERE deleted_at IS NULL.
 *
 * A full unique index on (tenant_id, email) permanently blocks re-inviting
 * the same email after a soft-delete. The fix scopes the constraint to
 * non-deleted rows only, so re-inviting succeeds once the previous account
 * is soft-deleted, while two ACTIVE rows with the same (tenant, email) are
 * still rejected.
 *
 * SQLite partial index syntax: CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL
 * (supported since SQLite 3.8.9; better-sqlite3 ships a sufficiently recent version)
 */

const TENANT = '00000000-0000-0000-0000-000000000001';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: InstanceType<typeof Database>;

function makeUser(id: string, email: string, deletedAt: number | null = null) {
    return {
        id,
        tenantId: TENANT,
        name: 'Test User',
        email,
        passwordHash: 'hash',
        role: 'admin',
        slug: id, // use id as slug to keep it unique across inserts
        createdAt: new Date(1_700_000_000_000),
        deletedAt: deletedAt === null ? null : new Date(deletedAt),
    };
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    sqlite = fixture.sqlite;
    await setupSchema(fixture.sqlite);

    // Seed the required tenant row
    await db.insert(schema.tenants).values({
        id: TENANT,
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: 'active',
        deploymentMode: 'shared',
        tier: 'free',
        createdAt: new Date(),
    });
});

describe('users (tenant_id, email) partial unique index (DB-2)', () => {
    it('allows re-inviting the same email after the prior account is soft-deleted', async () => {
        // First account — will be soft-deleted
        await db.insert(schema.users).values(
            makeUser('user-a1', 'alice@example.com'),
        );

        // Soft-delete it (set deleted_at to a non-null epoch)
        sqlite.exec(
            `UPDATE users SET deleted_at = 1700001000 WHERE id = 'user-a1'`,
        );

        // Re-invite the same email — must succeed because the prior row is deleted
        await expect(
            db.insert(schema.users).values(
                makeUser('user-a2', 'alice@example.com'),
            ),
        ).resolves.toBeDefined();
    });

    it('rejects a second ACTIVE row with the same (tenant, email)', async () => {
        // First active account
        await db.insert(schema.users).values(
            makeUser('user-b1', 'bob@example.com'),
        );

        // Second insert with the same email — no soft-delete, must throw UNIQUE violation
        await expect(
            db.insert(schema.users).values(
                makeUser('user-b2', 'bob@example.com'),
            ),
        ).rejects.toThrow(/UNIQUE constraint failed/i);
    });
});
