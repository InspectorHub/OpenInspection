/**
 * The state license becomes a credential row.
 *
 * This spec executes the REAL migration SQL rather than a reimplementation of
 * it, because the thing that can be wrong here is the SQL — a guard that does
 * not guard, a filter that misses soft-deleted users, a sort order that puts a
 * state license in among voluntary badges. A hand-written equivalent would test
 * the equivalent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';

/**
 * Located by NAME, not by sequence number. Migration numbers are a positional
 * token that a squash renumbers, so hard-coding one here would make this spec
 * fail for a reason that has nothing to do with the backfill — which is the
 * same reason `lint:migrefs` forbids them in comments.
 */
const MIGRATION_DIR = join(process.cwd(), 'migrations');
const MIGRATION_FILE = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('_license_number_backfill.sql'))
    .sort()
    .at(-1);
if (!MIGRATION_FILE) throw new Error('license_number backfill migration not found in migrations/');
const MIGRATION = readFileSync(join(MIGRATION_DIR, MIGRATION_FILE), 'utf8');

const DROP_FILE = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('_drop_users_license_number.sql'))
    .sort()
    .at(-1);
if (!DROP_FILE) throw new Error('license_number drop migration not found in migrations/');
const DROP = readFileSync(join(MIGRATION_DIR, DROP_FILE), 'utf8');

const T = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000a2';

describe('license_number backfill migration', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: BetterSqlite3.Database;

    const run = () => sqlite.exec(MIGRATION);
    const drop = () => sqlite.exec(DROP);
    const creds = () => db.select().from(schema.inspectorCredentials).all();
    const licenseColumnExists = () =>
        (sqlite.prepare(
            "SELECT count(*) AS n FROM pragma_table_info('users') WHERE name = 'license_number'",
        ).get() as { n: number }).n > 0;

    /**
     * `users.license_number` is GONE from the drizzle schema — the drop migration
     * below is what removed it. So the fixture re-creates it by hand and inserts
     * through raw SQL: this pair of migrations still runs, in this order, on every
     * fresh database, and a spec that could only describe the world after the drop
     * could not test the backfill at all.
     */
    async function user(id: string, licenseNumber: string | null, opts: { tenantId?: string; deletedAt?: Date } = {}) {
        await db.insert(schema.users).values({
            id, tenantId: opts.tenantId ?? T, email: id + '@acme.test', name: id,
            passwordHash: 'x', role: 'inspector',
            ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
            createdAt: new Date(),
        });
        sqlite.prepare('UPDATE users SET license_number = ? WHERE id = ?').run(licenseNumber, id);
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        sqlite.exec('ALTER TABLE users ADD COLUMN license_number text');
        for (const id of [T, T2]) {
            await db.insert(schema.tenants).values({
                id, name: 'Co ' + id, slug: 'co-' + id.slice(-2), status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
    });

    it('creates one text-only credential per licensed inspector', async () => {
        await user('u1', 'TX-9001');
        run();

        const rows = creds();
        expect(rows).toHaveLength(1);
        expect(rows[0].userId).toBe('u1');
        expect(rows[0].tenantId).toBe(T);
        // The string the old renderer hard-coded, so the line a recipient reads
        // does not change wording on the day the source of it does.
        expect(rows[0].label).toBe('Licensed home inspector');
        expect(rows[0].memberNumber).toBe('TX-9001');
        expect(rows[0].imageR2Key).toBeNull();
        expect(rows[0].active).toBe(true);
    });

    it('sorts the license BEFORE voluntary badges', async () => {
        // -1, not 0. The state license is the one credential with legal weight;
        // landing wherever insertion order puts it among association logos is
        // the wrong answer even though it looks like a cosmetic one.
        await user('u1', 'TX-9001');
        await db.insert(schema.inspectorCredentials).values({
            id: 'c-assoc', tenantId: T, userId: 'u1', label: 'InterNACHI CPI',
            memberNumber: 'N-1', imageR2Key: null, sortOrder: 0, active: true,
            createdAt: new Date(), updatedAt: new Date(),
        });
        run();

        const rows = creds().sort((a, b) => a.sortOrder - b.sortOrder);
        expect(rows.map((r) => r.label)).toEqual(['Licensed home inspector', 'InterNACHI CPI']);
        expect(rows[0].sortOrder).toBe(-1);
    });

    it('is IDEMPOTENT — a second run inserts nothing', async () => {
        // The only kind of data migration worth writing for a table this small:
        // one that can be re-run after a partial failure.
        await user('u1', 'TX-9001');
        run();
        run();
        run();
        expect(creds()).toHaveLength(1);
    });

    it('does not duplicate a license the inspector already entered by hand', async () => {
        await user('u1', 'TX-9001');
        await db.insert(schema.inspectorCredentials).values({
            id: 'c-manual', tenantId: T, userId: 'u1', label: 'State license',
            memberNumber: 'TX-9001', imageR2Key: null, sortOrder: 3, active: true,
            createdAt: new Date(), updatedAt: new Date(),
        });
        run();
        // The guard keys on the NUMBER, not the label — somebody who typed their
        // license in under their own wording must not end up with two of them.
        expect(creds()).toHaveLength(1);
        expect(creds()[0].id).toBe('c-manual');
    });

    it('skips users with no license, and blank or whitespace-only ones', async () => {
        await user('u-null', null);
        await user('u-empty', '');
        await user('u-spaces', '   ');
        run();
        expect(creds()).toHaveLength(0);
    });

    it('skips soft-deleted users', async () => {
        // Their license is not going on anything.
        await user('u-gone', 'TX-DEAD', { deletedAt: new Date() });
        await user('u-live', 'TX-LIVE');
        run();
        expect(creds().map((r) => r.memberNumber)).toEqual(['TX-LIVE']);
    });

    it('keeps each row on its own tenant', async () => {
        await user('u1', 'TX-1');
        await user('u2', 'TX-2', { tenantId: T2 });
        run();
        const rows = creds().sort((a, b) => a.tenantId.localeCompare(b.tenantId));
        expect(rows.map((r) => [r.tenantId, r.memberNumber])).toEqual([[T, 'TX-1'], [T2, 'TX-2']]);
    });

    it('gives every row a distinct id', async () => {
        for (let i = 0; i < 25; i++) await user('u' + i, 'TX-' + i);
        run();
        const ids = creds().map((r) => r.id);
        expect(new Set(ids).size).toBe(25);
        // UUID-shaped, so these ids read like every other id in the schema.
        expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    });

    it('drops the column only AFTER the credential row exists', async () => {
        // The order is the whole safety property. Backfill first, drop second:
        // reverse them and every licensed inspector loses their licence with no
        // way back, because the column was the only place it lived.
        await user('u1', 'TX-9001');
        run();
        expect(creds()[0].memberNumber).toBe('TX-9001');

        drop();
        expect(licenseColumnExists()).toBe(false);
        // The credential must survive the drop — it is the licence now.
        expect(creds()[0].memberNumber).toBe('TX-9001');
    });

    it('drops the column in place, without rebuilding the FK-referenced table', async () => {
        // A generated migration would have emitted the 12-step rebuild
        // (CREATE __new_users / INSERT / DROP TABLE users / RENAME), and that
        // `DROP TABLE` on a table six others reference is what loses rows on
        // remote D1. SQLite's native DROP COLUMN keeps the table's identity, so
        // the assertion that matters is that the other rows are still here.
        await user('u1', 'TX-9001');
        await user('u2', null);
        run();
        drop();

        const rows = await db.select().from(schema.users).all();
        expect(rows.map((r) => r.id).sort()).toEqual(['u1', 'u2']);
        // Statements only — the migration's own comment NAMES the rebuild it is
        // avoiding, so matching the raw file would match the explanation.
        const statements = DROP.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
        expect(/DROP TABLE/i.test(statements)).toBe(false);
        expect(/ALTER TABLE `?users`? DROP COLUMN/i.test(statements)).toBe(true);
    });
});
