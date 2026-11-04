/**
 * C22: a key rotation retires the active key and inserts the new one as ONE batch where the driver has batches (D1 does; better-sqlite3
 * does not, so the unit tests give the database a batch of their own, run as one transaction), and the partial unique index lets only one
 * of two concurrent rotations through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { d1For } from '../helpers/d1-binding';
import { SigningKeyService } from '../../../server/services/signing-key.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SECRET = 'rotation-secret-rotation-secret-1234';

describe('rotateKeypair as one batch', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let batches: unknown[][];

    /**
     * The test database as a D1 binding whose `batch` is recorded. `atomic` runs the statements inside one transaction, as D1's batch
     * does; without it they run in turn, which is how a driver with no transaction behind its batch would write them.
     */
    function batching(atomic: boolean): D1Database {
        const real = d1For(db);
        return {
            prepare: (sql: string) => real.prepare(sql),
            batch: async (queries: Array<{ execSync: () => unknown }>) => {
                batches.push(queries);
                const run = () => queries.map((q) => q.execSync());
                return atomic ? sqlite.transaction(run)() : run();
            },
        } as unknown as D1Database;
    }
    let binding: D1Database;
    const svc = () => new SigningKeyService(binding, SECRET, []);
    const activeRows = () => db.select().from(schema.signingKeys).where(and(eq(schema.signingKeys.tenantId, TENANT), isNull(schema.signingKeys.retiredAt))).all();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        batches = [];
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        binding = batching(true);
    });
    afterEach(() => vi.restoreAllMocks());

    it('retires the old key and inserts the new one in ONE batch, and leaves exactly one active key', async () => {
        const first = await svc().ensureKeypair(TENANT);
        const rotated = await svc().rotateKeypair(TENANT);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toHaveLength(2);
        expect(rotated.retired).toBe(first.fingerprint);
        const active = await activeRows();
        expect(active).toHaveLength(1);
        expect(active[0]!.fingerprint).toBe(rotated.fingerprint);
        expect(await db.select().from(schema.signingKeys).all()).toHaveLength(2);
    });

    it('a new key that cannot be stored leaves the old key active, because the retirement is rolled back with it', async () => {
        const first = await svc().ensureKeypair(TENANT);
        sqlite.exec("CREATE TRIGGER refuse_new_key BEFORE INSERT ON signing_keys BEGIN SELECT RAISE(ABORT, 'insert refused'); END;");
        await expect(svc().rotateKeypair(TENANT)).rejects.toThrow(/insert refused/);
        const active = await activeRows();
        expect(active).toHaveLength(1);
        expect(active[0]!.fingerprint).toBe(first.fingerprint);
        expect(active[0]!.retiredAt).toBeNull();
    });

    // The drizzle D1 handle always has batch(), so the service's no-batch fallback (typeof batch !== 'function') is
    // not reachable through a D1 binding; this pins why the batch must be ATOMIC: a batch that ran its statements in
    // turn would leave no active key after the same failure.
    it('a batch that is not atomic would leave no active key after the same failure: the next signing request mints one, which is why the batch must be a transaction', async () => {
        binding = batching(false);
        await svc().ensureKeypair(TENANT);
        sqlite.exec("CREATE TRIGGER refuse_new_key BEFORE INSERT ON signing_keys BEGIN SELECT RAISE(ABORT, 'insert refused'); END;");
        await expect(svc().rotateKeypair(TENANT)).rejects.toThrow(/insert refused/);
        expect(await activeRows()).toHaveLength(0);
        sqlite.exec('DROP TRIGGER refuse_new_key');
        const minted = await svc().ensureKeypair(TENANT);
        expect(minted.fingerprint).toBeTruthy();
        expect(await activeRows()).toHaveLength(1);
    });

    it('two rotations at once: the partial unique index lets one through, the other fails whole, and one key is active', async () => {
        await svc().ensureKeypair(TENANT);
        const results = await Promise.allSettled([svc().rotateKeypair(TENANT), svc().rotateKeypair(TENANT)]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(String(rejected.reason)).toMatch(/UNIQUE constraint failed/);
        const active = await activeRows();
        expect(active).toHaveLength(1);
        // The key that lost left nothing behind: the original, the winner's key, and no third.
        expect(await db.select().from(schema.signingKeys).all()).toHaveLength(2);
    });
});
