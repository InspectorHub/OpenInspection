/**
 * The `contractor_type_trade_slug_backfill` migration — the existing-tenant half of #277.
 *
 * The file is located by its NAME SUFFIX rather than its sequence number, and
 * that is not fussiness: a squash renumbers every migration, and a spec that
 * hardcoded `0028_` would either fail to find the file or — worse, if some other
 * migration inherited the number — read a different one and keep passing.
 *
 * WHAT THIS MIGRATION IS FOR. `trade_slug` shipped with the table (it is in
 * `0000_baseline.sql`), and the SEED that fills it in — `CONTRACTOR_TYPES`,
 * derived from `DEFECT_TRADES` — only runs for a workspace being created. Every
 * workspace that already existed still carries the ten hand-written names from
 * before the vocabulary was aligned, eight of which map onto a canonical trade
 * and none of which say so. Until they do, a defect tagged
 * `mold-remediation-specialist` renders that trade in the report while the
 * repair-item dropdown cannot offer it.
 *
 * ⚠️ WHY THE ASSERTIONS ARE SPLIT BY PATH, AND WHY THAT IS NOT TIDINESS. The
 * plan this came from specified one test asserting the slug set EQUALS
 * `DEFECT_TRADES` and another asserting `Foundation Specialist` exists with a
 * NULL slug. Those cannot both hold. They are also about two different code
 * paths: the first is the NEW-TENANT seed (covered by
 * `tests/unit/integrations/starter-content-contractor-types.spec.ts`), this file
 * is the EXISTING-TENANT backfill. Everything below is about the second path.
 *
 * ⚠️ THE VACUOUS SHAPE THIS FILE HAS TO AVOID. "Assert the twenty trades exist
 * afterwards" passes just as well if they were there all along, and would pass
 * against a migration containing nothing at all. Every assertion below is
 * therefore paired with the count BEFORE, and the whole migration is applied a
 * SECOND time — because the interesting failure is not that it does too little,
 * it is that `contractor_types` has no unique index on `(tenant_id, name)` and a
 * naive completion doubles every workspace's dropdown on a re-run.
 *
 * THREE TENANTS, THREE STATES, on purpose:
 *   A — the untouched legacy ten. The case the migration is written for.
 *   B — already complete and already slugged. Must gain and lose nothing.
 *   C — holds `licensed-electrician` under a renamed label AND a legacy
 *       `Licensed Electrician` with no slug. The partial unique index would
 *       make stamping that row a constraint violation, and a migration that
 *       raises one does not fail a row, it kills `d1 migrations apply` and every
 *       later migration in the chain. C proves the guard degrades to a skip.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setupSchema } from '../db';
import { CONTRACTOR_TYPES } from '../../../server/services/starter-content/fixtures/contractor-types';
import { DEFECT_TRADES } from '../../../server/types/defect-fields';

const MIGRATIONS_DIR = resolve(__dirname, '../../../migrations');
const SUFFIX = '_contractor_type_trade_slug_backfill.sql';

/**
 * Exactly one match, asserted rather than assumed. Zero means the migration was
 * folded into a squash and every assertion below would be exercising nothing;
 * two means an ambiguity a `[0]` would silently pick a side in.
 */
function migrationPath(): string {
    const matches = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(SUFFIX));
    if (matches.length !== 1) {
        throw new Error(
            `expected exactly one migrations/*${SUFFIX}, found ${matches.length}: ${matches.join(', ')}`,
        );
    }
    return join(MIGRATIONS_DIR, matches[0]!);
}

const A = 'tenant-legacy';
const B = 'tenant-complete';
const C = 'tenant-renamed';

/**
 * The ten names an existing workspace carries, read out of production on
 * 2026-08-10 and recorded in the design's mapping table. Eight map onto a
 * canonical trade; the last two are ours to keep, not ours to delete.
 */
const LEGACY_TEN: ReadonlyArray<[name: string, sortOrder: number]> = [
    ['Licensed Electrician', 1],
    ['Plumber', 2],
    ['Roofer', 3],
    ['HVAC Technician', 4],
    ['General Contractor', 5],
    ['Structural Engineer', 6],
    ['Foundation Specialist', 7],
    ['Pest/Termite', 8],
    ['Chimney Sweep', 9],
    ['Grading/Drainage', 10],
];

/** The three whose wording differs, and what they must become. */
const RENAMED: ReadonlyArray<[was: string, becomes: string, slug: string]> = [
    ['Plumber', 'Licensed Plumber', 'licensed-plumber'],
    ['Roofer', 'Licensed Roofer', 'licensed-roofer'],
    ['Pest/Termite', 'Pest-control Professional', 'pest-control'],
];

/** The five that already read correctly and must NOT be renamed. */
const STAMPED_ONLY: ReadonlyArray<[name: string, slug: string]> = [
    ['Licensed Electrician', 'licensed-electrician'],
    ['HVAC Technician', 'hvac-technician'],
    ['General Contractor', 'general-contractor'],
    ['Structural Engineer', 'structural-engineer'],
    ['Chimney Sweep', 'chimney-sweep'],
];

/** The two with no counterpart. NULL here is permanent, not a backfill gap. */
const EXTRAS = ['Foundation Specialist', 'Grading/Drainage'];

let sqlite: InstanceType<typeof Database>;

function insertTenant(id: string) {
    sqlite
        .prepare('INSERT INTO tenants (id, slug, created_at) VALUES (?, ?, 0)')
        .run(id, id);
}

function insertType(id: string, tenantId: string, name: string, sortOrder: number, slug: string | null) {
    sqlite
        .prepare(
            'INSERT INTO contractor_types (id, tenant_id, name, sort_order, created_at, trade_slug) VALUES (?, ?, ?, ?, 0, ?)',
        )
        .run(id, tenantId, name, sortOrder, slug);
}

/** Apply the migration exactly as `d1 migrations apply` would: statement by statement. */
function applyBackfill() {
    const sql = readFileSync(migrationPath(), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
        if (stmt.trim()) sqlite.exec(stmt);
    }
}

function typesOf(tenantId: string) {
    return sqlite
        .prepare('SELECT id, name, sort_order AS sortOrder, trade_slug AS tradeSlug FROM contractor_types WHERE tenant_id = ? ORDER BY sort_order')
        .all(tenantId) as Array<{ id: string; name: string; sortOrder: number; tradeSlug: string | null }>;
}

function duplicateSlugCount() {
    const row = sqlite
        .prepare(
            'SELECT COUNT(*) AS c FROM (SELECT tenant_id, trade_slug FROM contractor_types WHERE trade_slug IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1)',
        )
        .get() as { c: number };
    return row.c;
}

beforeEach(async () => {
    sqlite = new Database(':memory:');
    await setupSchema(sqlite);

    insertTenant(A);
    insertTenant(B);
    insertTenant(C);

    // A — the untouched legacy ten, every slug NULL.
    LEGACY_TEN.forEach(([name, sortOrder]) => insertType(`a-${sortOrder}`, A, name, sortOrder, null));

    // B — already complete, already slugged, straight from the fixture.
    CONTRACTOR_TYPES.forEach((ct, i) => insertType(`b-${i}`, B, ct.name, ct.sortOrder, ct.tradeSlug));

    // C — the collision. `Our Sparky` already claims the electrician trade.
    insertType('c-1', C, 'Our Sparky', 1, 'licensed-electrician');
    insertType('c-2', C, 'Licensed Electrician', 2, null);
});

afterEach(() => {
    sqlite.close();
});

describe('0028 — contractor_type trade_slug backfill', () => {
    it('starts from a workspace with nothing mapped (anti-vacuity)', () => {
        // Without this, every "the trade is mapped afterwards" assertion below
        // would pass against an empty migration on a database that was already
        // in the target state.
        const before = typesOf(A);
        expect(before).toHaveLength(10);
        expect(before.filter((r) => r.tradeSlug !== null)).toHaveLength(0);
    });

    it('stamps the five whose names already read correctly, and does NOT rename them', () => {
        const before = typesOf(A);
        STAMPED_ONLY.forEach(([name]) => {
            expect(before.find((r) => r.name === name)?.tradeSlug).toBeNull();
        });

        applyBackfill();

        const after = typesOf(A);
        STAMPED_ONLY.forEach(([name, slug]) => {
            const row = after.find((r) => r.name === name);
            // The name surviving is half the assertion: a backfill that rewrote
            // every label to the fixture's would also make the slug correct.
            expect(row, `${name} disappeared`).toBeDefined();
            expect(row!.tradeSlug).toBe(slug);
        });
    });

    it('stamps AND renames the three whose wording differs', () => {
        const before = typesOf(A);
        RENAMED.forEach(([was]) => {
            expect(before.some((r) => r.name === was), `${was} not present before`).toBe(true);
        });

        applyBackfill();

        const after = typesOf(A);
        RENAMED.forEach(([was, becomes, slug]) => {
            expect(after.some((r) => r.name === was), `${was} was not renamed`).toBe(false);
            expect(after.find((r) => r.name === becomes)?.tradeSlug).toBe(slug);
        });
    });

    it('renaming a row does not move the id a comment points at', () => {
        // The licence for renaming at all: `comments.recommended_contractor_type_id`
        // stores the id, not the name. Asserted rather than trusted, because the
        // obvious wrong implementation — delete the legacy row and insert the
        // canonical one — passes every other test in this file.
        const plumberId = typesOf(A).find((r) => r.name === 'Plumber')!.id;
        sqlite
            .prepare(
                'INSERT INTO comments (id, tenant_id, text, recommended_contractor_type_id, created_at) VALUES (?, ?, ?, ?, 0)',
            )
            .run('cmt-1', A, 'Recommend repair', plumberId);

        applyBackfill();

        const ref = sqlite
            .prepare('SELECT recommended_contractor_type_id AS ct FROM comments WHERE id = ?')
            .get('cmt-1') as { ct: string };
        const target = typesOf(A).find((r) => r.id === ref.ct);
        expect(target, 'the referenced contractor type no longer exists').toBeDefined();
        expect(target!.name).toBe('Licensed Plumber');
        expect(target!.tradeSlug).toBe('licensed-plumber');
    });

    it('leaves the two tenant-visible extras with a NULL slug, and keeps them', () => {
        applyBackfill();

        const after = typesOf(A);
        EXTRAS.forEach((name) => {
            const row = after.find((r) => r.name === name);
            expect(row, `${name} was deleted`).toBeDefined();
            expect(row!.tradeSlug).toBeNull();
        });
        // Positive control for the negative above: NULL here is a decision, not
        // a migration that failed to stamp anything at all.
        expect(after.filter((r) => r.tradeSlug !== null).length).toBeGreaterThan(0);
    });

    it('completes the canonical set — 10 rows in, 22 out, one per trade', () => {
        expect(typesOf(A)).toHaveLength(10);

        applyBackfill();

        const after = typesOf(A);
        expect(after).toHaveLength(22);
        expect([...new Set(after.map((r) => r.tradeSlug).filter(Boolean))].sort())
            .toEqual([...DEFECT_TRADES].sort());
    });

    it('gives the inserted rows the names and sort orders the seeder would', () => {
        // If these drift, a workspace that later re-seeds gets a second row for
        // the same trade under a different label — or, now that the partial
        // unique index exists, an error nobody can explain.
        applyBackfill();

        const after = typesOf(A);
        // The twelve that had no row at all. The eight pre-existing ones keep
        // their own sort_order, which is the tenant's, not ours to renumber.
        const preexisting = new Set([...STAMPED_ONLY.map(([, s]) => s), ...RENAMED.map(([, , s]) => s)]);
        for (const ct of CONTRACTOR_TYPES) {
            if (ct.tradeSlug === null || preexisting.has(ct.tradeSlug)) continue;
            const row = after.find((r) => r.tradeSlug === ct.tradeSlug);
            expect(row, `${ct.tradeSlug} was not inserted`).toBeDefined();
            expect(row!.name).toBe(ct.name);
            expect(row!.sortOrder).toBe(ct.sortOrder);
        }
    });

    it('mints real v4 uuids for the rows it inserts', () => {
        applyBackfill();

        const inserted = typesOf(A).filter((r) => !r.id.startsWith('a-'));
        expect(inserted).toHaveLength(12);
        for (const row of inserted) {
            expect(row.id, `${row.tradeSlug} got ${row.id}`)
                .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        }
        expect(new Set(inserted.map((r) => r.id)).size).toBe(inserted.length);
    });

    it('is a no-op on the second run — the missing unique index on (tenant_id, name)', () => {
        // THE test this file exists for. `contractor_types` is unique on
        // (tenant_id, trade_slug) and on nothing else, so a completion keyed on
        // the name, or one with no guard at all, doubles the dropdown the second
        // time it runs — and `d1 migrations apply` re-running is not exotic.
        applyBackfill();
        const afterFirst = typesOf(A);
        expect(afterFirst).toHaveLength(22);
        expect(duplicateSlugCount()).toBe(0);

        applyBackfill();

        const afterSecond = typesOf(A);
        expect(afterSecond).toHaveLength(22);
        expect(duplicateSlugCount()).toBe(0);
        expect(afterSecond.map((r) => r.id).sort()).toEqual(afterFirst.map((r) => r.id).sort());
    });

    it('changes nothing for a workspace that is already complete', () => {
        const before = typesOf(B);
        expect(before).toHaveLength(22);

        applyBackfill();

        expect(typesOf(B)).toEqual(before);
    });

    it('skips — rather than aborts on — a workspace that already holds the trade under another name', () => {
        // The partial unique index makes stamping `Licensed Electrician` here a
        // constraint violation, and a raising migration does not fail one row:
        // it stops `d1 migrations apply` and blocks every migration after it.
        // Production is pinned to the untouched ten so it cannot hit this; a
        // self-hosted install has arbitrary tenant-authored names and no pin.
        expect(() => applyBackfill()).not.toThrow();

        const after = typesOf(C);
        expect(after.find((r) => r.name === 'Our Sparky')?.tradeSlug).toBe('licensed-electrician');
        // Left alone and left NULL — the migration declined to choose, which is
        // correct. It is also not silent: the header records the query that
        // lists these rows so the outcome is a report, not an absence.
        expect(after.find((r) => r.name === 'Licensed Electrician')?.tradeSlug).toBeNull();
        expect(duplicateSlugCount()).toBe(0);

        // Positive control — the same name in a workspace WITHOUT the collision
        // is stamped, so the skip above is the guard firing and not the whole
        // statement being broken.
        expect(typesOf(A).find((r) => r.name === 'Licensed Electrician')?.tradeSlug)
            .toBe('licensed-electrician');
    });

    it('does not leak a row across workspaces', () => {
        applyBackfill();
        // C had 2 rows and is missing 19 canonical trades; it must get exactly
        // those, and nothing A or B owns.
        const c = typesOf(C);
        expect(c.filter((r) => r.name === 'Our Sparky')).toHaveLength(1);
        expect(new Set(c.map((r) => r.tradeSlug).filter(Boolean)).size)
            .toBe(DEFECT_TRADES.length);
    });
});
