/**
 * `createTestDb()` opens a serialized image of the migrated schema instead of
 * replaying the migration files, and `setupSchema()` is a no-op on that handle.
 * That is only a speed-up if the image is the same database, so this compares
 * the two ways of getting a schema, object for object.
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, setupSchema } from '../db';

type Master = { type: string; name: string; tbl_name: string; sql: string | null };

function master(sqlite: Database.Database): Master[] {
    return sqlite
        .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
        .all() as Master[];
}

async function replayed(): Promise<Database.Database> {
    // A handle that did not come from createTestDb(), so setupSchema replays the files.
    const sqlite = new Database(':memory:');
    await setupSchema(sqlite);
    return sqlite;
}

describe('createTestDb schema image', () => {
    it('has exactly the objects, columns and indexes the migration files produce', async () => {
        const fromFiles = await replayed();
        const { sqlite } = createTestDb();

        const a = master(fromFiles);
        const b = master(sqlite);
        // Guard against comparing two empty databases.
        expect(a.filter((o) => o.type === 'table').length).toBeGreaterThan(100);
        expect(a.filter((o) => o.type === 'index').length).toBeGreaterThan(100);
        expect(b).toEqual(a);

        for (const t of a.filter((o) => o.type === 'table' && !o.name.startsWith('sqlite_'))) {
            const cols = (db: Database.Database) => db.prepare(`PRAGMA table_xinfo("${t.name}")`).all();
            expect(cols(sqlite), `columns of ${t.name}`).toEqual(cols(fromFiles));
            const idx = (db: Database.Database) => db.prepare(`PRAGMA index_list("${t.name}")`).all();
            expect(idx(sqlite), `indexes of ${t.name}`).toEqual(idx(fromFiles));
        }
        fromFiles.close();
        sqlite.close();
    });

    it('hands out an independent copy each time, so a write in one test cannot reach the next', () => {
        const first = createTestDb().sqlite;
        const second = createTestDb().sqlite;
        first.exec(`CREATE TABLE scratch_marker (id integer)`);
        first.exec('INSERT INTO scratch_marker VALUES (1)');
        expect(second.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'scratch_marker'").get()).toEqual({ n: 0 });
        first.close();
        second.close();
    });

    it('leaves setupSchema a no-op on a templated handle (no "table already exists")', async () => {
        const { sqlite } = createTestDb();
        await expect(setupSchema(sqlite)).resolves.toBeUndefined();
        sqlite.close();
    });

    it('still replays the files for a plain handle, which then matches the image', async () => {
        const plain = await replayed();
        const { sqlite } = createTestDb();
        expect(master(plain).length).toBe(master(sqlite).length);
        plain.close();
        sqlite.close();
    });
});
