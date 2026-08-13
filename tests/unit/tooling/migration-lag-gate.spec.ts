/**
 * Unit tests for the migration-lag gate (`scripts/check-migration-lag.mjs`).
 *
 * The gate answers ONE question `db:check` never asked: does the target D1
 * database's `d1_migrations` table contain every migration committed to this
 * repo? On 2026-08-09 the SaaS core database was six migrations behind the
 * repo's head, and nothing in CI, pre-push, or the release skills could see
 * it — `db:check` compares the Drizzle schema against `migrations/`, and both
 * of those live in the repo. The 2026-08-12 squash later collapsed that whole
 * numbered chain into a single `0000_baseline.sql`, so the fixtures below are
 * built from today's one-file shape rather than the numbered filenames the
 * 2026-08-09 incident actually involved.
 *
 * Three properties are covered, because the first two mask each other:
 *
 *  1. **It reports lag, by name.** A count alone would not have told anyone
 *     which features were about to hit a database that had never heard of
 *     them.
 *  2. **It fails closed.** Every way of failing to READ the applied set — an
 *     API error payload, a truncated banner, a query that reported
 *     `success: false` — must throw, never return `[]`. An empty applied set and
 *     an unreadable database are the same numeric answer and opposite verdicts;
 *     a gate that conflates them re-creates the exact blind spot.
 *  3. **Both numbers always print.** `renderReport` is asserted to contain the
 *     repo count AND the applied count in the IN-SYNC case too. A gate that
 *     prints its comparison only when it fails is a gate nobody can sanity-check
 *     on a good day.
 *
 * Positive controls throughout: `parseAppliedNames` must ACCEPT a real captured
 * wrangler payload (a parser hardened by rejecting everything would otherwise
 * pass every fail-closed assertion), and `diffMigrations` must return an empty
 * verdict for two identical sets. The lag fixtures are built from the REAL
 * `migrations/` directory rather than invented names, so the spec cannot pass
 * vacuously against an empty or missing directory.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? process.cwd(), '../../..');
const GATE = path.join(ROOT, 'scripts', 'check-migration-lag.mjs');

type Diff = {
    missing: string[];
    extra: string[];
    acceptedExtra: string[];
    staleAccepted: string[];
};

let parseAppliedNames: (stdout: string) => string[];
let diffMigrations: (a: {
    repoFiles: string[];
    applied: string[];
    acceptedExtra?: string[];
}) => Diff;
let renderReport: (a: Record<string, unknown>) => string;
let isMissingMigrationsTable: (text: string) => boolean;

beforeAll(async () => {
    ({ parseAppliedNames, diffMigrations, renderReport, isMissingMigrationsTable } = await import(
        /* @vite-ignore */ pathToFileURL(GATE).href
    ));
});

// This file's SUBJECT is migration filenames: they are fixture data and captured
// payloads, not prose citing a migration. They are interpolated rather than
// inlined so the capture and its expectation cannot drift apart. The extra two
// rows are synthetic (not real migration names, before or after the squash) —
// `parseAppliedNames` only reads the `name` column of each row, so nothing
// about the shape of that string is under test here.
const CAPTURED_BASELINE = '0000_baseline.sql';
const CAPTURED_SECOND = 'add_widgets_table.sql';
const CAPTURED_THIRD = 'add_gadgets_index.sql';

/** A real `wrangler d1 execute --remote --json` capture, banner and all. */
const REAL_WRANGLER_STDOUT = `▲ [WARNING] Processing wrangler.saas.jsonc configuration:

    - "unsafe" fields are experimental and may change or break at any time.


[
  {
    "results": [
      { "name": "${CAPTURED_BASELINE}" },
      { "name": "${CAPTURED_SECOND}" },
      { "name": "${CAPTURED_THIRD}" }
    ],
    "success": true,
    "meta": { "served_by": "v3-prod", "rows_read": 57, "rows_written": 0 }
  }
]`;

const REAL_MIGRATIONS = readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

describe('check-migration-lag: reading the applied set', () => {
    // POSITIVE CONTROL — without this, every throw-assertion below would also
    // pass for a parser that rejects its own real input.
    it('parses a real wrangler --json capture, banner included', () => {
        expect(parseAppliedNames(REAL_WRANGLER_STDOUT)).toEqual([
            CAPTURED_BASELINE,
            CAPTURED_SECOND,
            CAPTURED_THIRD,
        ]);
    });

    it('parses an empty-but-successful result set as zero applied', () => {
        const out = '[{"results": [], "success": true, "meta": {}}]';
        expect(parseAppliedNames(out)).toEqual([]);
    });

    it.each([
        ['nothing at all', ''],
        ['banner only, no JSON', '▲ [WARNING] something happened'],
        ['a Cloudflare API error object', '{"error":{"text":"not authorized [code: 7403]"}}'],
        ['an empty payload array', '[]'],
        ['success: false', '[{"results": [], "success": false, "meta": {}}]'],
        ['no results array', '[{"success": true, "meta": {}}]'],
        ['a row with no name column', '[{"results": [{"id": 1}], "success": true}]'],
        ['truncated JSON', '[{"results": [{"name": "0001.sql"}'],
    ])('throws rather than returning [] for %s', (_label, stdout) => {
        expect(() => parseAppliedNames(stdout)).toThrow();
    });

    it('recognises a missing d1_migrations table without treating it as success', () => {
        expect(isMissingMigrationsTable('D1_ERROR: no such table: d1_migrations')).toBe(true);
        expect(isMissingMigrationsTable('no such table: main.d1_migrations: SQLITE_ERROR')).toBe(true);
        expect(isMissingMigrationsTable('no such column: trade_slug')).toBe(false);
        expect(isMissingMigrationsTable('')).toBe(false);
    });
});

describe('check-migration-lag: the comparison', () => {
    // Was `toBeGreaterThan(10)` against a 57-file chain. The 2026-08-12 squash
    // collapsed that chain to a single `0000_baseline.sql`, so the bar drops to
    // what the guard actually needs: at least one real file, so the fixtures
    // below exercise `diffMigrations` against genuine repo content rather than
    // an empty directory that would make every comparison pass vacuously.
    it('has real migrations to compare (guards the fixtures below)', () => {
        expect(REAL_MIGRATIONS.length).toBeGreaterThan(0);
    });

    // POSITIVE CONTROL for the whole diff.
    it('reports nothing when the database has applied exactly the repo set', () => {
        const d = diffMigrations({ repoFiles: REAL_MIGRATIONS, applied: [...REAL_MIGRATIONS] });
        expect(d).toEqual({ missing: [], extra: [], acceptedExtra: [], staleAccepted: [] });
    });

    // Was a `.slice(-6)` fixture reproducing the 2026-08-09 incident (a database
    // missing four named features: `trade_slug`, `repair_action_tag`,
    // `ai_content_reviews`, `inspector_narrative`). A one-file chain cannot
    // reconstruct that shape — there is nothing left to slice six of — so this
    // now exercises the same code at its most fundamental boundary instead of
    // faking a multi-file lag: a database that has applied NOTHING is missing
    // EVERYTHING. Still built from the real migrations/ directory, per the
    // module's own rule against invented names.
    it('names every migration the database has not applied', () => {
        const d = diffMigrations({ repoFiles: REAL_MIGRATIONS, applied: [] });
        expect(d.missing).toEqual(REAL_MIGRATIONS);
        expect(d.extra).toEqual([]);
    });

    it('is loud when the DATABASE is ahead of the repo', () => {
        const d = diffMigrations({
            repoFiles: REAL_MIGRATIONS,
            applied: [...REAL_MIGRATIONS, '9999_applied_by_hand.sql'],
        });
        expect(d.extra).toEqual(['9999_applied_by_hand.sql']);
        expect(d.missing).toEqual([]);
    });

    it('accepts pre-rebuild names only when the baseline declares them', () => {
    // migrefs-allow: fixture data for a gate whose subject IS migration filenames.
        const applied = [...REAL_MIGRATIONS, '0001_auth.sql'];
        expect(diffMigrations({ repoFiles: REAL_MIGRATIONS, applied }).extra).toEqual([
            '0001_auth.sql',
        ]);
        const allowed = diffMigrations({
            repoFiles: REAL_MIGRATIONS,
            applied,
    // migrefs-allow: fixture data for a gate whose subject IS migration filenames.
            acceptedExtra: ['0001_auth.sql'],
        });
        expect(allowed.extra).toEqual([]);
        expect(allowed.acceptedExtra).toEqual(['0001_auth.sql']);
    });

    it('flags a baseline entry the database no longer has (a stale allowlist hides drift)', () => {
        const d = diffMigrations({
            repoFiles: REAL_MIGRATIONS,
            applied: [...REAL_MIGRATIONS],
    // migrefs-allow: fixture data for a gate whose subject IS migration filenames.
            acceptedExtra: ['0001_long_gone.sql'],
        });
        expect(d.staleAccepted).toEqual(['0001_long_gone.sql']);
    });
});

describe('check-migration-lag: the report prints BOTH numbers', () => {
    const base = {
        label: 'openinspection-db-saas',
        source: 'wrangler.saas.jsonc → DB (remote)',
        migrationsDir: 'migrations',
    };

    // The formatting IS the feature: a summary that hides the comparison it
    // claims to make is how every other gate in this repo failed.
    it('shows repo count, applied count and the difference when IN SYNC', () => {
        const out = renderReport({
            ...base,
            repoCount: 57,
            appliedCount: 57,
            missing: [],
            extra: [],
        });
        expect(out).toMatch(/repo\s+migrations\/\*\.sql\s+57/);
        expect(out).toMatch(/database\s+d1_migrations rows\s+57/);
        expect(out).toMatch(/difference\s+0/);
        expect(out).toContain('in sync');
    });

    // Portal's production database permanently carries 48 pre-rebuild filenames
    // that can never reappear in the repo. Subtracting them on their own line —
    // instead of silently discounting them — keeps the two headline numbers
    // reconcilable by eye, which is the entire point of printing them together.
    it('subtracts baseline-accepted pre-rebuild names on a visible line', () => {
        const out = renderReport({
            ...base,
            label: 'portal-db-saas',
            repoCount: 7,
            appliedCount: 55,
            missing: [],
            extra: [],
            acceptedExtra: Array.from({ length: 48 }, (_, i) => `legacy_${i}.sql`),
        });
        expect(out).toMatch(/repo\s+migrations\/\*\.sql\s+7/);
        expect(out).toMatch(/database\s+d1_migrations rows\s+55/);
        expect(out).toMatch(/less pre-rebuild names \(baseline\)\s+-48/);
        expect(out).toMatch(/difference\s+0/);
        expect(out).toContain('in sync');
    });

    it('shows both counts AND the missing filenames when behind', () => {
        const out = renderReport({
            ...base,
            repoCount: 57,
            appliedCount: 51,
            missing: ['add_repair_action_tag.sql', 'add_inspector_narrative.sql'],
            extra: [],
        });
        expect(out).toMatch(/repo\s+migrations\/\*\.sql\s+57/);
        expect(out).toMatch(/database\s+d1_migrations rows\s+51/);
        expect(out).toMatch(/difference\s+6/);
        expect(out).toContain('add_repair_action_tag.sql');
        expect(out).toContain('add_inspector_narrative.sql');
        expect(out).not.toContain('in sync');
    });

    it('shows a NEGATIVE difference when the database is ahead', () => {
        const out = renderReport({
            ...base,
            repoCount: 51,
            appliedCount: 57,
            missing: [],
            extra: ['add_inspector_narrative.sql'],
        });
        expect(out).toMatch(/difference\s+-6/);
        expect(out).toContain('APPLIED OUT OF BAND');
    });
});

describe('check-migration-lag: the CLI exit code is the contract', () => {
    // Reachable with no network: the migrations directory is resolved before
    // wrangler is ever spawned.
    it('exits non-zero when it cannot even find the migrations directory', () => {
        const r = spawnSync(process.execPath, [GATE, '--migrations-dir', 'no-such-dir'], {
            cwd: ROOT,
            encoding: 'utf8',
        });
        expect(r.status).toBe(1);
        expect(`${r.stderr}`).toContain('migration-lag gate');
    });

    it('exits non-zero on an unrecognised argument rather than checking nothing', () => {
        const r = spawnSync(process.execPath, [GATE, '--totally-made-up'], {
            cwd: ROOT,
            encoding: 'utf8',
        });
        expect(r.status).toBe(1);
    });
});
