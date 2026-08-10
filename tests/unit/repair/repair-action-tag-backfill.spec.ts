/**
 * #275 — the legacy-credit backfill, run as the REAL migration SQL.
 *
 * The thing that can be wrong here is the SQL: a WHERE that misses rows, a tag
 * written over one somebody chose, an UPDATE that is not re-runnable. A
 * hand-written equivalent would test the equivalent.
 *
 * ⚠️ Acceptance is a COUNT, not a spot check. `rows with a credit BEFORE` must
 * equal `rows tagged fund AFTER`, and both numbers are printed side by side so
 * the difference is visible rather than inferred. This is the whole point of the
 * decision: gating the amount input on `tag === 'fund'` hides the credit on
 * every untagged row, and nothing looks wrong when it happens.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Located by NAME, not by sequence number: a squash renumbers migrations, and a
 * hard-coded number here would fail for a reason unrelated to the backfill —
 * the same reason `lint:migrefs` bans numbers in comments.
 */
const MIGRATION_DIR = join(process.cwd(), 'migrations');
const ALL = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith('.sql')).sort();
const TAG_FILE = ALL.filter((f) => f.endsWith('_repair_action_tag.sql')).at(-1);
if (!TAG_FILE) throw new Error('repair_action_tag migration not found in migrations/');
const TAG_MIGRATION = readFileSync(join(MIGRATION_DIR, TAG_FILE), 'utf8');

/** Everything up to, but NOT including, the migration under test. */
const EARLIER = ALL.slice(0, ALL.indexOf(TAG_FILE));

const T = '00000000-0000-0000-0000-0000000000a1';

describe('repair_action_tag backfill migration', () => {
    let sqlite: BetterSqlite3.Database;

    /** Insert through raw SQL: the column under test does not exist yet. */
    function legacyItem(id: string, creditCents: number | null) {
        sqlite.prepare(
            'INSERT INTO repair_request_items (id, tenant_id, repair_request_id, finding_key, section_title, item_label, requested_credit_cents, sort_order)'
            + " VALUES (?, ?, 'rr1', ?, 'Roof', 'Shingles', ?, 0)",
        ).run(id, T, 'canned:s1:i1:' + id, creditCents);
    }

    const countWithCredit = () => (sqlite.prepare(
        'SELECT count(*) AS n FROM repair_request_items WHERE requested_credit_cents IS NOT NULL',
    ).get() as { n: number }).n;

    const countTagged = (tag: string) => (sqlite.prepare(
        'SELECT count(*) AS n FROM repair_request_items WHERE repair_action_tag = ?',
    ).get(tag) as { n: number }).n;

    const run = () => sqlite.exec(TAG_MIGRATION);

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.pragma('foreign_keys = OFF');
        for (const f of EARLIER) sqlite.exec(readFileSync(join(MIGRATION_DIR, f), 'utf8'));
    });

    it('the column does not exist until this migration runs', () => {
        // Proves EARLIER really is "everything before", so the before-count below
        // is taken in the world the backfill actually lands in. Without this the
        // spec could be silently measuring a database that already had the column.
        const has = (sqlite.prepare(
            "SELECT count(*) AS n FROM pragma_table_info('repair_request_items') WHERE name = 'repair_action_tag'",
        ).get() as { n: number }).n;
        expect(has).toBe(0);
    });

    it('rows with a credit BEFORE equals rows tagged fund AFTER', () => {
        for (let i = 0; i < 7; i++) legacyItem('with-' + i, 1000 * (i + 1));
        for (let i = 0; i < 4; i++) legacyItem('without-' + i, null);

        const before = countWithCredit();
        run();
        const after = countTagged('fund');

        // Printed side by side on purpose: the difference IS the defect.
        // eslint-disable-next-line no-console
        console.log(`[#275 backfill] rows with a credit before = ${before}; rows tagged fund after = ${after}`);
        expect(after).toBe(before);
        expect(before).toBe(7);
    });

    it('a zero credit is a credit — the buyer typed it', () => {
        // `WHERE requested_credit_cents IS NOT NULL`, never a truthiness test. A
        // deliberate 0 is a stated ask and reads as falsy in every language the
        // migration might be rewritten in.
        legacyItem('zero', 0);
        run();
        expect(countTagged('fund')).toBe(1);
    });

    it('leaves rows with no credit untagged', () => {
        legacyItem('none', null);
        run();
        expect(countTagged('fund')).toBe(0);
        const row = sqlite.prepare('SELECT repair_action_tag AS t FROM repair_request_items WHERE id = ?').get('none') as { t: string | null };
        expect(row.t).toBeNull();
    });

    it('is re-runnable, and never overwrites a tag somebody chose', () => {
        legacyItem('a', 5000);
        run();
        sqlite.prepare("UPDATE repair_request_items SET repair_action_tag = 'replace' WHERE id = 'a'").run();
        // The re-run is what a partially-applied migration looks like on retry.
        sqlite.exec(TAG_MIGRATION.split('--> statement-breakpoint')[1]!);
        const row = sqlite.prepare('SELECT repair_action_tag AS t FROM repair_request_items WHERE id = ?').get('a') as { t: string };
        expect(row.t).toBe('replace');
    });

    it('does not extend the inference to any other tag value', () => {
        // Recorded as an assertion because the decision was explicitly bounded:
        // a credit implies `fund` and nothing implies anything else.
        legacyItem('a', 5000);
        legacyItem('b', null);
        run();
        for (const tag of ['repair', 'replace', 'other']) {
            expect(countTagged(tag), `nothing should be backfilled to '${tag}'`).toBe(0);
        }
    });
});
