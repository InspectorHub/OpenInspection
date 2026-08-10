/**
 * The partial unique index on `contractor_types (tenant_id, trade_slug)`.
 *
 * WHY A BEHAVIOURAL TEST AND NOT A SCHEMA ASSERTION. An index whose predicate
 * is wrong is completely silent. Drop the `WHERE trade_slug IS NOT NULL` and
 * the migration still applies, `db:check` still passes (schema and migrations
 * agree — they are both wrong together), every existing spec still goes green,
 * and the damage only appears the first time a workspace adds a second
 * custom contractor type and the insert is rejected for no reason a user could
 * understand. Nothing in the gate ladder can see that. Only exercising the
 * three cases can.
 *
 * Each case is a different way to get this index wrong:
 *   - the predicate is read back  → catches dropping WHERE / narrowing it
 *   - two NULLs allowed           → catches making the column NOT NULL, or
 *                                   sentinel-slugging un-mapped types
 *   - duplicate slug refused      → catches dropping UNIQUE, or the whole index
 *   - same slug, other tenant OK  → catches indexing `trade_slug` alone
 *
 * ⚠️ ONE THING THIS CANNOT BE STRUCTURED AS. The obvious design — "insert two
 * NULLs, that proves the WHERE clause is there" — is a false green, and it was
 * written that way first. **SQLite already treats NULLs as distinct in a unique
 * index**, so deleting `WHERE trade_slug IS NOT NULL` leaves all four
 * behaviours identical; the whole file stays green against an index that no
 * longer says what it means. The predicate is about keeping un-mapped rows out
 * of the index (and saying so), not about NULL semantics — so the only way to
 * pin it is to read it back out of `sqlite_master`, which is what the first
 * test does.
 *
 * The constraint exists because seeding dedupes by slug in APPLICATION code,
 * against a snapshot read. `starter-content.service.ts` says so in its own
 * comment. A backfill that stamps a slug onto a legacy row for a trade the
 * workspace already has must fail loudly rather than leave two rows for one
 * trade, with `defectTrade -> contractorType` resolving to whichever the query
 * returned first.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupSchema } from '../db';

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

let sqlite: InstanceType<typeof Database>;

function insert(id: string, tenantId: string, name: string, tradeSlug: string | null) {
    sqlite
        .prepare(
            'INSERT INTO contractor_types (id, tenant_id, name, sort_order, created_at, trade_slug) VALUES (?, ?, ?, 0, 0, ?)',
        )
        .run(id, tenantId, name, tradeSlug);
}

beforeEach(async () => {
    sqlite = new Database(':memory:');
    await setupSchema(sqlite);
});

afterEach(() => {
    sqlite.close();
});

describe('contractor_types — one row per canonical trade per workspace', () => {
    it('is unique, composite, and partial — read back from the database', () => {
        // Also the anti-vacuity guard for everything below: with no index at
        // all, the "allowed" cases would pass while testing nothing.
        const row = sqlite
            .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
            .get('uq_contractor_types_tenant_trade') as { sql: string } | undefined;

        expect(row?.sql, 'uq_contractor_types_tenant_trade is missing').toBeTruthy();
        const ddl = row!.sql.replace(/`/g, '').toUpperCase();
        expect(ddl).toContain('UNIQUE INDEX');
        expect(ddl).toContain('(TENANT_ID,TRADE_SLUG)');
        // The predicate no behaviour can reveal — see the header note.
        expect(ddl).toContain('WHERE TRADE_SLUG IS NOT NULL');
    });

    it('lets a workspace keep as many un-mapped types as it likes', () => {
        // The normal state. A tenant-created type ("Foundation Specialist") has
        // no canonical counterpart, so NULL is permanent, not a backfill gap.
        insert('a1', TENANT, 'Foundation Specialist', null);
        expect(() => insert('a2', TENANT, 'Pool Inspector', null)).not.toThrow();

        const count = sqlite
            .prepare('SELECT COUNT(*) AS c FROM contractor_types WHERE tenant_id = ?')
            .get(TENANT) as { c: number };
        expect(count.c).toBe(2);
    });

    it('refuses a second row for a trade the workspace already has', () => {
        insert('b1', TENANT, 'Licensed Roofer', 'roofer');
        // The renamed-label case: same trade, different display name. Matching
        // on `name` would not catch this, which is the entire reason the slug
        // column exists.
        expect(() => insert('b2', TENANT, 'Our Roof Guy', 'roofer')).toThrow(/UNIQUE/i);
    });

    it('scopes the constraint to one workspace', () => {
        insert('c1', TENANT, 'Licensed Roofer', 'roofer');
        expect(() => insert('c2', OTHER, 'Licensed Roofer', 'roofer')).not.toThrow();
    });
});
