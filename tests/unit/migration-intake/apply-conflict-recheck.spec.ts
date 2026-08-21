/**
 * The half hour between deciding and doing.
 *
 * Conflicts are worked out when a run is staged. Apply can happen much later —
 * the operator spends time in the repair step, and a colleague creates the very
 * contact this run was about to insert. Acting on the stale answer produces a
 * duplicate the operator was never asked about.
 *
 * So every row is re-checked against the SAME rule immediately before it is
 * written, and a row whose answer moved is failed with the change itself
 * written down. Neither silently taking the new answer nor silently keeping the
 * old one is acceptable: both make a decision on the operator's behalf, and the
 * reason they saw that row at all is that we asked them to decide.
 *
 * The rest of the run continues, and the batch lands partially_applied.
 *
 * ── Why the clash is created AFTER staging in every case here ───────────────
 * A clash seeded before `stage()` is seen by the STAGE-time check, and a test
 * built that way passes without a re-check existing at all. The window this
 * guard covers only opens once the plan has been written down, so every setup
 * below stages first and moves the world second.
 *
 * ── Why the reasons are asserted by their WORDS ─────────────────────────────
 * Two of these cases fail today for a different reason: the writer looks the
 * target up and finds it gone. Asserting only `failed: 1` would therefore pass
 * against code with no re-check in it. What distinguishes the two is what the
 * row says — a re-checked row names the entry and asks the operator to look at
 * it again, and the writer's own message does neither.
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
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

/**
 * One section, not none. A template with no sections is now a PROBLEM ROW — the
 * apply path asks `describeRowProblem` before it writes anything, so an empty
 * document would fail here for a reason that has nothing to do with the
 * conflict re-check these specs are about.
 */
const DOC: TemplateSchemaV2 = { schemaVersion: 2, sections: [{ id: 'sec_a', title: 'Roof', items: [] }] };
const STATS: BundleTemplate['stats'] = {
    sections: 1, items: 0, information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
};

function contactsBundle(list: { name: string; email: string }[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: EMPTY,
                contact: { readFromSource: list.length, emitted: list.length, dropped: [] },
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [],
        contacts: list.map((c) => ({ ...c, type: 'client' as const })),
        members: [],
    };
}

function templateBundle(name: string): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'spectora' },
            adapter: { name: 'spectora', version: '1' },
            counts: {
                template: { readFromSource: 1, emitted: 1, dropped: [] },
                contact: EMPTY,
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [{ name, schema: DOC, stats: STATS }],
        contacts: [], members: [],
    };
}

describe('apply re-checks conflicts against the live data', () => {
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

    function rowsOf(batchId: string) {
        return db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
    }

    it('fails a row whose target appeared after it was reviewed, and keeps going', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            bundle: contactsBundle([
                { name: 'Alice', email: 'alice@example.test' },
                { name: 'Bob', email: 'bob@example.test' },
            ]),
        });
        // Staging saw no clash — this is the state the re-check has to notice
        // has moved, and asserting it here is what makes the setup below the
        // apply-time window rather than the stage-time one.
        expect(staged.rows.map((r) => r.conflictWith)).toEqual([null, null]);

        // A colleague creates one of them while the operator is in the repair step.
        await db.insert(schema.contacts).values({
            id: 'made-meanwhile', tenantId: TENANT, type: 'client',
            name: 'Alice Elsewhere', email: 'alice@example.test', createdAt: new Date(),
        });

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
            )).get();
        expect(failed?.outcome).toMatch(/alice@example\.test/);
        expect(failed?.outcome).toMatch(/review/i);

        // Neither answer was taken: no second Alice, and the one that appeared
        // meanwhile was not overwritten either.
        const alices = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.email, 'alice@example.test')).all();
        expect(alices).toHaveLength(1);
        expect(alices[0].name).toBe('Alice Elsewhere');

        // Positive control: the row after the failure still got its turn.
        const rows = await rowsOf(staged.batchId);
        expect(rows.find((r) => r.position === 1)?.status).toBe('applied');
    });

    it('fails a row whose target disappeared after it was reviewed', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client',
            name: 'Alice Old', email: 'alice@example.test', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            bundle: contactsBundle([{ name: 'Alice New', email: 'alice@example.test' }]),
        });
        expect(staged.rows[0].conflictWith).toBe('existing-1');
        await db.delete(schema.contacts).where(eq(schema.contacts.id, 'existing-1'));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        expect(result.failed).toBe(1);
        // The row was NOT inserted as a new contact just because the clash went
        // away — that is the "silently take the new answer" half of the rule.
        expect(await db.select().from(schema.contacts).all()).toEqual([]);
        // And the reason is the re-check's, not the writer's: it names the entry
        // and sends the operator back to it. The writer's own "no longer exists"
        // does neither, so an implementation with no re-check fails this line.
        const row = (await rowsOf(staged.batchId))[0];
        expect(row?.outcome).toMatch(/alice@example\.test/);
        expect(row?.outcome).toMatch(/review/i);
    });

    it('applies normally when nothing moved', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            bundle: contactsBundle([{ name: 'Alice', email: 'alice@example.test' }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 1, failed: 0 });
    });

    it('leaves a clash that was there all along to the policy, not to the re-check', async () => {
        // Positive control for the two failures above: an answer that did NOT
        // move is settled the ordinary way. Without this, a re-check that failed
        // every clashing row would pass both of them.
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client',
            name: 'Alice Old', email: 'alice@example.test', phone: '555-1', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            bundle: contactsBundle([{ name: 'Alice New', email: 'alice@example.test' }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 1, failed: 0 });
        const live = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-1')).get();
        expect(live?.name).toBe('Alice New');
    });

    it('re-checks a template overwrite target too', async () => {
        await db.insert(schema.templates).values({
            id: 'tpl-1', tenantId: TENANT, name: 'Live', version: 1,
            schema: JSON.stringify(DOC), createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.overwrite', targetId: 'tpl-1', limits: LIMITS,
            bundle: templateBundle('Replacement'),
        });
        expect(staged.rows[0].conflictWith).toBe('tpl-1');
        await db.delete(schema.templates).where(eq(schema.templates.id, 'tpl-1'));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        expect(result.failed).toBe(1);
        expect(await db.select().from(schema.templates).all()).toEqual([]);
        const row = (await rowsOf(staged.batchId))[0];
        expect(row?.outcome).toMatch(/Replacement/);
        expect(row?.outcome).toMatch(/review/i);
    });

    it('positive control: a template overwrite whose target is still there applies', async () => {
        await db.insert(schema.templates).values({
            id: 'tpl-1', tenantId: TENANT, name: 'Live', version: 1,
            schema: JSON.stringify(DOC), createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.overwrite', targetId: 'tpl-1', limits: LIMITS,
            bundle: templateBundle('Replacement'),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 1, failed: 0 });
    });
});
