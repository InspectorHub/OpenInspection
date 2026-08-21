/**
 * Applying template rows.
 *
 * Three properties are pinned here and relied on by every later entity kind:
 * only pending rows are consumed (so an interrupted run resumes rather than
 * duplicates), an overwrite captures what it replaced BEFORE replacing it (so
 * the undo is an operation rather than a claim), and a run with any failure
 * lands on partially_applied rather than applied.
 *
 * `prior_state` is asserted by its CONTENT throughout. A snapshot that is
 * merely present proves nothing about a revert: an empty object is present too,
 * and restoring one would empty the template the undo was supposed to rescue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import type {
    BundleTemplate,
    EntityCounts,
    MigrationBundleV1,
} from '../../../server/lib/migration-intake/bundle';
import type { TemplateSchemaV2 } from '../../../server/types/template-schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const TEMPLATE = '33333333-3333-3333-3333-3333333333c3';

const SCHEMA_A: TemplateSchemaV2 = {
    schemaVersion: 2,
    sections: [{ id: 'sec_a', title: 'Roof', items: [] }],
};
const SCHEMA_B: TemplateSchemaV2 = {
    schemaVersion: 2,
    sections: [{ id: 'sec_b', title: 'Attic', items: [] }],
};

const STATS: BundleTemplate['stats'] = {
    sections: 1, items: 0, information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
};

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function templateBundle(list: { name: string; schema: TemplateSchemaV2 }[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'spectora' },
            adapter: { name: 'spectora', version: '1' },
            counts: {
                template: { readFromSource: list.length, emitted: list.length, dropped: [] },
                contact: EMPTY,
                member: EMPTY,
            },
            warnings: [],
        },
        templates: list.map((t) => ({ name: t.name, schema: t.schema, stats: STATS })),
        contacts: [],
        members: [],
    };
}

/**
 * `templates.schema` is a json-mode column that production writes through
 * `TemplateService`, which hands it an already-stringified document — so a row
 * seeded here is seeded the same way, and reads back as a string exactly as a
 * real one does. Seeding a raw object instead would make this fixture the only
 * place in the product where that column holds one.
 */
function seedTemplate(
    db: BetterSQLite3Database<typeof schema>,
    id: string,
    name: string,
    doc: TemplateSchemaV2,
) {
    return db.insert(schema.templates).values({
        id, tenantId: TENANT, name, version: 1,
        schema: JSON.stringify(doc), createdAt: new Date(),
    });
}

/** The stored document, whichever of the two shapes the column hands back. */
function readSchema(stored: unknown): unknown {
    return typeof stored === 'string' ? JSON.parse(stored) : stored;
}

describe('MigrationApplyService — template rows', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;
    let apply: MigrationApplyService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The staging step batches its writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
        apply = new MigrationApplyService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('creates one template per row and records the id it minted', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle([{ name: 'Imported', schema: SCHEMA_A }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });

        expect(result).toMatchObject({ status: 'applied', applied: 1, skipped: 0, failed: 0 });

        const created = await db.select().from(schema.templates).all();
        expect(created).toHaveLength(1);
        expect(created[0].name).toBe('Imported');
        expect(readSchema(created[0].schema)).toEqual(SCHEMA_A);

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        expect(row?.status).toBe('applied');
        expect(row?.createdId).toBe(created[0].id);
        expect(row?.outcome).toBeNull();
        // Nothing was replaced, so there is nothing to restore. The overwrite
        // case below is the positive control for this column.
        expect(row?.priorState).toBeNull();
        expect(row?.appliedAt).not.toBeNull();
    });

    it('marks the batch applied, stamps applied_at and records the policy that was used', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle([{ name: 'Imported', schema: SCHEMA_A }]),
        });
        await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, staged.batchId)).get();
        expect(batch?.status).toBe('applied');
        expect(batch?.conflictPolicy).toBe('skip');
        expect(batch?.appliedAt).not.toBeNull();
    });

    it('captures the replaced document before overwriting it', async () => {
        await seedTemplate(db, TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templateBundle([{ name: 'Replacement', schema: SCHEMA_B }]),
        });
        await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });

        const live = await db.select().from(schema.templates).where(eq(schema.templates.id, TEMPLATE)).get();
        expect(readSchema(live?.schema)).toEqual(SCHEMA_B);
        expect(live?.version).toBe(2);
        // The name stays: the operator pointed at THIS template, and the
        // document is the only field this path touches — which is also why the
        // snapshot below is complete.
        expect(live?.name).toBe('Live');
        expect(await db.select().from(schema.templates).all()).toHaveLength(1);

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        // Asserted by content, section id included: a snapshot that merely
        // exists would restore whatever it happens to hold, and `{}` is a
        // perfectly good non-null value.
        const prior = readSchema(row?.priorState) as TemplateSchemaV2;
        expect(prior).toEqual(SCHEMA_A);
        expect(prior.sections.map((s) => s.id)).toEqual(['sec_a']);
        expect(prior).not.toEqual(SCHEMA_B);
        expect(row?.createdId).toBe(TEMPLATE);
        expect(row?.status).toBe('applied');
    });

    it('leaves the target alone when the operator settles an overwrite as a skip', async () => {
        await seedTemplate(db, TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templateBundle([{ name: 'Replacement', schema: SCHEMA_B }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 0, skipped: 1, failed: 0 });

        const live = await db.select().from(schema.templates).where(eq(schema.templates.id, TEMPLATE)).get();
        expect(readSchema(live?.schema)).toEqual(SCHEMA_A);
        expect(live?.version).toBe(1);

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        expect(row?.status).toBe('skipped');
        expect(row?.outcome).toBeTruthy();
        expect(row?.priorState).toBeNull();
        expect(row?.createdId).toBeNull();
    });

    /**
     * Under a batch-wide policy the batch column already carries the answer, so
     * the row column stays null; under `per_row` the answer is this row's alone
     * and the row is the only place it can be read back from. Both halves are
     * asserted, because a column written unconditionally and a column never
     * written look identical from one side.
     */
    it('records a per-row settlement on the row, and a batch-wide one only on the batch', async () => {
        await seedTemplate(db, TEMPLATE, 'Live', SCHEMA_A);
        const perRow = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templateBundle([{ name: 'Replacement', schema: SCHEMA_B }]),
        });
        await apply.apply({
            tenantId: TENANT, batchId: perRow.batchId, conflictPolicy: 'per_row', seatQuotaEnforced: false,
            rowResolutions: { [perRow.rows[0].id]: 'overwrite' },
        });
        const perRowRow = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, perRow.rows[0].id)).get();
        expect(perRowRow?.resolution).toBe('overwrite');
        expect(perRowRow?.status).toBe('applied');

        const batchWide = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templateBundle([{ name: 'Again', schema: SCHEMA_A }]),
        });
        await apply.apply({
            tenantId: TENANT, batchId: batchWide.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        const batchWideRow = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, batchWide.rows[0].id)).get();
        expect(batchWideRow?.resolution).toBeNull();
        expect(batchWideRow?.status).toBe('applied');
    });

    it('defaults an unanswered per-row clash to keeping what is already there', async () => {
        await seedTemplate(db, TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templateBundle([{ name: 'Replacement', schema: SCHEMA_B }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'per_row', seatQuotaEnforced: false,
            rowResolutions: {},
        });
        expect(result).toMatchObject({ applied: 0, skipped: 1 });
        const live = await db.select().from(schema.templates).where(eq(schema.templates.id, TEMPLATE)).get();
        expect(readSchema(live?.schema)).toEqual(SCHEMA_A);
    });

    it('refuses a second apply rather than quietly doing nothing', async () => {
        // This used to assert that a second apply returned `applied: 0`. The
        // batch claim now refuses a finished run outright, which is the better
        // answer to a double click — "nothing happened" and "that already ran"
        // are different things to tell an operator. The property the old
        // assertion protected still holds and is still asserted below: the
        // template was written exactly once. See apply-claim.spec.ts.
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle([{ name: 'Once', schema: SCHEMA_A }]),
        });
        const first = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(first.applied).toBe(1);

        await expect(apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        })).rejects.toThrow(/already/i);
        expect(await db.select().from(schema.templates).all()).toHaveLength(1);
    });

    it('resumes a half-applied batch and only touches what is left', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle([
                { name: 'First', schema: SCHEMA_A },
                { name: 'Second', schema: SCHEMA_B },
            ]),
        });
        // Simulate an interrupted run: the first row already landed.
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
        const first = rows.find((r) => r.position === 0)!;
        await seedTemplate(db, 'already-there', 'First', SCHEMA_A);
        await db.update(schema.migrationRows)
            .set({ status: 'applied', createdId: 'already-there', appliedAt: new Date() })
            .where(eq(schema.migrationRows.id, first.id));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result.applied).toBe(1);
        const all = await db.select().from(schema.templates).all();
        expect(all.map((t) => t.name).sort()).toEqual(['First', 'Second']);
        // The row that was already applied kept the id it recorded — a resumed
        // run must not restamp what it did not do.
        const resumedFirst = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, first.id)).get();
        expect(resumedFirst?.createdId).toBe('already-there');
    });

    it('lands on partially_applied when any row fails, and names the reason on that row', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle([
                { name: 'Good', schema: SCHEMA_A },
                { name: 'Bad', schema: SCHEMA_B },
            ]),
        });
        // Corrupt the second row's payload so its WRITE cannot succeed — while
        // leaving it something `describeRowProblem` has no objection to. The
        // apply path now refuses a problem row before it tries, so a payload
        // with no sections would be failed by that gate instead and this spec
        // would stop exercising the per-row catch it exists for.
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
        const second = rows.find((r) => r.position === 1)!;
        await db.update(schema.migrationRows)
            .set({
                payload: JSON.stringify({
                    name: 'Bad',
                    schema: { schemaVersion: 99, sections: [{ id: 'sec_x', title: 'Roof', items: [] }] },
                    stats: STATS,
                }),
            })
            .where(eq(schema.migrationRows.id, second.id));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result.status).toBe('partially_applied');
        expect(result.applied).toBe(1);
        expect(result.failed).toBe(1);

        const failed = await db.select().from(schema.migrationRows)
            .where(and(
                eq(schema.migrationRows.batchId, staged.batchId),
                eq(schema.migrationRows.status, 'failed'),
            ))
            .get();
        expect(failed?.position).toBe(1);
        expect(failed?.outcome).toBeTruthy();
        expect(failed?.outcome).toMatch(/schema/i);
        expect(failed?.createdId).toBeNull();

        // Positive control for the two assertions above: the row that DID work
        // carries the opposite of both, so "everything is null" cannot pass.
        const applied = await db.select().from(schema.migrationRows)
            .where(and(
                eq(schema.migrationRows.batchId, staged.batchId),
                eq(schema.migrationRows.status, 'applied'),
            ))
            .get();
        expect(applied?.outcome).toBeNull();
        expect(applied?.createdId).not.toBeNull();

        // The failure stopped nothing: the good row is in the real table.
        expect((await db.select().from(schema.templates).all()).map((t) => t.name)).toEqual(['Good']);

        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, staged.batchId)).get();
        expect(batch?.status).toBe('partially_applied');
    });

    it('refuses to apply a batch belonging to another tenant, and writes nothing', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle([{ name: 'Imported', schema: SCHEMA_A }]),
        });
        await expect(apply.apply({
            tenantId: 'someone-else', batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        })).rejects.toThrow(/not found/i);

        expect(await db.select().from(schema.templates).all()).toEqual([]);
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, staged.batchId)).get();
        expect(batch?.status).toBe('staged');
        expect(batch?.conflictPolicy).toBeNull();
    });
});
