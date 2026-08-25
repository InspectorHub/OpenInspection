/**
 * What a run looks like before anybody presses apply.
 *
 * Three buckets, and every row lands in exactly ONE. A row that both cannot be
 * written and clashes with something belongs in `problems`: whether it can be
 * written at all has not been settled, so asking "overwrite or skip" is asking
 * about something that may never happen. Once repaired it reappears under
 * `conflicts`, because the report is derived from the rows and recomputed.
 *
 * The equation is asserted and both sides are printed. A report that shows only
 * problems cannot distinguish "nothing is wrong" from "nothing was examined".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import {
    BUNDLE_CONTACT_TYPES,
    type BundleMember,
    type EntityCounts,
    type MigrationBundleV1,
} from '../../../server/lib/migration-intake/bundle';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { MigrationReportService } from '../../../server/services/migration-intake/report.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function contactsBundle(list: unknown[]): MigrationBundleV1 {
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
        templates: [], contacts: list as MigrationBundleV1['contacts'], members: [],
    };
}

function membersBundle(list: BundleMember[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: EMPTY,
                contact: EMPTY,
                member: { readFromSource: list.length, emitted: list.length, dropped: [] },
            },
            warnings: [],
        },
        templates: [], contacts: [], members: list,
    };
}

/**
 * A converted template with one rated item, one that landed as plain text, an
 * empty section, and one entry the conversion could not carry.
 *
 * Every one of those is a fact the preview step reports and the four counts
 * cannot.
 */
function templateBundle(): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'home_inspector_pro' },
            adapter: { name: 'home-inspector-pro', version: '1' },
            counts: {
                template: {
                    readFromSource: 2,
                    emitted: 1,
                    dropped: [{ at: 'row 42', reason: 'Executive Summary has no item' }],
                },
                contact: EMPTY,
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [{
            name: 'Whole House Checklist',
            schema: {
                schemaVersion: 2,
                sections: [
                    {
                        id: 's1',
                        title: 'Roof',
                        items: [
                            {
                                id: 'i1', label: 'Covering', type: 'rich',
                                ratingOptions: ['Satisfactory'],
                                tabs: { information: [], limitations: [], defects: [] },
                            },
                            { id: 'i2', label: 'Flashing', type: 'textarea' },
                        ],
                    },
                    { id: 's2', title: 'Attic', items: [] },
                ],
            },
            stats: {
                sections: 2, items: 2,
                information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
            },
        }],
        contacts: [], members: [],
    };
}

describe('MigrationReportService', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;
    let report: MigrationReportService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The staging step batches its writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared',
            tier: 'free', maxUsers: 12, createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
        // No run staged here records a source key, so the report never reaches
        // the bucket. A stub that would THROW if it did is deliberate: it turns
        // an accidental read into a failure rather than a quiet null.
        report = new MigrationReportService({} as D1Database, {} as R2Bucket);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    /**
     * Stage the given contact entries, including ones no adapter would have
     * produced.
     *
     * The format validator refuses an entry with no name, and the repair step
     * exists precisely for rows that arrive from a converted file — so each
     * entry is staged through a stand-in that passes validation, and its real
     * payload is written onto the row afterwards.
     *
     * The stand-in keeps the EMAIL. That is the field conflicts are decided on,
     * and a stand-in without it would stage every row as clashing with nothing
     * — which would quietly turn the conflicts bucket into a column of zeroes
     * no assertion here could tell from a real answer.
     */
    async function stageContacts(list: Record<string, unknown>[]) {
        const standIns = list.map((entry) => {
            const type = typeof entry.type === 'string' ? entry.type : '';
            return {
                name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : 'placeholder',
                ...(typeof entry.email === 'string' && entry.email.includes('@')
                    ? { email: entry.email }
                    : {}),
                type: (BUNDLE_CONTACT_TYPES as readonly string[]).includes(type)
                    ? type
                    : 'client',
            };
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            bundle: contactsBundle(standIns),
        });
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
        for (const row of rows) {
            await db.update(schema.migrationRows)
                .set({ payload: JSON.stringify(list[row.position]) })
                .where(eq(schema.migrationRows.id, row.id));
        }
        return staged.batchId;
    }

    it('counts a clean run as all ok, and the equation holds', async () => {
        const batchId = await stageContacts([
            { name: 'Alice', email: 'alice@example.test', type: 'client' },
            { name: 'Bob', email: 'bob@example.test', type: 'client' },
        ]);
        const r = await report.build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(r.counts).toEqual({ total: 2, ok: 2, conflicts: 0, problems: 0 });
        expect(r.counts.ok + r.counts.conflicts + r.counts.problems).toBe(r.counts.total);
        expect(r.problemRows).toEqual([]);
        expect(r.blockedReason).toBeNull();
    });

    it('puts a clashing row in conflicts and leaves apply available', async () => {
        await db.insert(schema.contacts).values({
            id: 'e1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const batchId = await stageContacts([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]);
        const r = await report.build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(r.counts).toEqual({ total: 1, ok: 0, conflicts: 1, problems: 0 });
        expect(r.counts.ok + r.counts.conflicts + r.counts.problems).toBe(r.counts.total);
        expect(r.blockedReason).toBeNull();
    });

    it('puts a row that both clashes AND is unwritable in problems only', async () => {
        await db.insert(schema.contacts).values({
            id: 'e1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const batchId = await stageContacts([{ name: '', email: 'alice@example.test', type: 'client' }]);
        // The clash is real and recorded on the row — the point is that the
        // report does not COUNT it while the row cannot be written at all. A
        // fixture that staged no clash would pass this without the rule.
        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).get();
        expect(row?.conflictWith).toBe('e1');

        const r = await report.build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(r.counts).toEqual({ total: 1, ok: 0, conflicts: 0, problems: 1 });
        expect(r.problemRows[0].field).toBe('name');
    });

    it('blocks apply while any row has a problem, and says how many', async () => {
        const batchId = await stageContacts([
            { name: '', type: 'client' },
            { name: '', type: 'client' },
            { name: 'Fine', type: 'client' },
        ]);
        const r = await report.build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(r.counts).toEqual({ total: 3, ok: 1, conflicts: 0, problems: 2 });
        expect(r.blockedReason).toMatch(/2 entries/);
    });

    it('pages the problem list and reports the total behind it', async () => {
        const batchId = await stageContacts(
            Array.from({ length: 7 }, () => ({ name: '', type: 'client' })),
        );
        const r = await report.build({ tenantId: TENANT, batchId, seatQuotaEnforced: false, page: 2, pageSize: 3 });
        expect(r.problemRows).toHaveLength(3);
        expect(r.problemRowsTotal).toBe(7);
        expect(r.page).toBe(2);
        expect(r.pageSize).toBe(3);
        // A page is a WINDOW, not a sample: these are entries 4-6 in the
        // operator's own file, and a page that re-showed the first three would
        // satisfy the length assertion above.
        expect(r.problemRows.map((p) => p.position)).toEqual([3, 4, 5]);
    });

    it('blocks apply on a seat shortfall, naming both numbers', async () => {
        await db.update(schema.tenants).set({ maxUsers: 2 }).where(eq(schema.tenants.id, TENANT));
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: 'boss@example.test', passwordHash: 'x',
            role: 'owner', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite', limits: LIMITS,
            bundle: membersBundle([0, 1, 2].map((i) => ({
                email: `p${i}@example.test`, role: 'inspector' as const,
            }))),
        });
        const r = await report.build({
            tenantId: TENANT, batchId: staged.batchId, seatQuotaEnforced: true,
        });
        // BOTH numbers, in one sentence. "Not enough seats" leaves the operator
        // to work out how many people to remove from their file.
        expect(r.blockedReason).toMatch(/needs 3 seats and 1 are available/);
    });

    it('positive control: the same run is not blocked where the deployment has no seat quota', async () => {
        await db.update(schema.tenants).set({ maxUsers: 2 }).where(eq(schema.tenants.id, TENANT));
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: 'boss@example.test', passwordHash: 'x',
            role: 'owner', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite', limits: LIMITS,
            bundle: membersBundle([0, 1, 2].map((i) => ({
                email: `p${i}@example.test`, role: 'inspector' as const,
            }))),
        });
        const r = await report.build({
            tenantId: TENANT, batchId: staged.batchId, seatQuotaEnforced: false,
        });
        expect(r.blockedReason).toBeNull();
    });

    it('names the problem count FIRST when a run has both a problem and a shortfall', async () => {
        await db.update(schema.tenants).set({ maxUsers: 1 }).where(eq(schema.tenants.id, TENANT));
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite', limits: LIMITS,
            bundle: membersBundle([
                { email: 'a@example.test', role: 'inspector' },
                { email: 'b@example.test', role: 'inspector' },
            ]),
        });
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
        await db.update(schema.migrationRows)
            .set({ payload: JSON.stringify({ email: '', role: 'inspector' }) })
            .where(eq(schema.migrationRows.id, rows[0].id));

        const r = await report.build({
            tenantId: TENANT, batchId: staged.batchId, seatQuotaEnforced: true,
        });
        // Reading down the run: fix what cannot be written before arguing about
        // how many seats the rest needs. The shortfall is real here — the
        // positive control below shows this same run reporting it once the
        // problem is gone — so this is an ORDER assertion, not an absence.
        expect(r.blockedReason).toMatch(/1 entry/);
        expect(r.blockedReason).not.toMatch(/seats/);
    });

    it('positive control: that same run reports the shortfall once the problem is repaired', async () => {
        await db.update(schema.tenants).set({ maxUsers: 1 }).where(eq(schema.tenants.id, TENANT));
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite', limits: LIMITS,
            bundle: membersBundle([
                { email: 'a@example.test', role: 'inspector' },
                { email: 'b@example.test', role: 'inspector' },
            ]),
        });
        const r = await report.build({
            tenantId: TENANT, batchId: staged.batchId, seatQuotaEnforced: true,
        });
        expect(r.counts).toEqual({ total: 2, ok: 2, conflicts: 0, problems: 0 });
        expect(r.blockedReason).toMatch(/needs 2 seats and 1 are available/);
    });

    it('carries the STRUCTURE of a template run, drops and all', async () => {
        // The four counts add up for a conversion that produced nothing usable
        // as readily as for a perfect one, which is why the report has to carry
        // more than counts. The dropped entries come off the MANIFEST: a
        // dropped entry has no staged row, so rows alone would report a clean
        // import of a file that lost two comments.
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.create', limits: LIMITS,
            bundle: templateBundle(),
        });
        const r = await report.build({
            tenantId: TENANT, batchId: staged.batchId, seatQuotaEnforced: false,
        });
        expect(r.entityKind).toBe('template');
        expect(r.structure?.name).toBe('Whole House Checklist');
        expect(r.structure?.sections.map((sec) => sec.title)).toEqual(['Roof', 'Attic']);
        expect(r.structure?.sections[0]?.items.map((i) => i.landedAs))
            .toEqual(['rated', 'plain']);
        expect(r.structure?.dropped.map((d) => d.reason)).toEqual(['Executive Summary has no item']);
    });

    it('carries NO structure for a run of contacts — the positive control', async () => {
        // Their repair table already is a row-by-row preview, so a second
        // screen would show the same rows with less on them. Without this, the
        // case above would be satisfied by a report that always built one.
        const batchId = await stageContacts([{ name: 'Alice', type: 'client' }]);
        const r = await report.build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(r.structure).toBeNull();
        expect(r.entityKind).toBe('contact');
    });

    it('refuses to build a report for another tenant batch', async () => {
        const batchId = await stageContacts([{ name: 'Alice', type: 'client' }]);
        await expect(report.build({
            tenantId: 'someone-else', batchId, seatQuotaEnforced: false,
        })).rejects.toThrow(/not found/i);
    });
});
