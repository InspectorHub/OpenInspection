/**
 * Editing a staged run without starting it over.
 *
 * Two different edits live here. Repairing ONE entry writes its payload back in
 * place, which is what lets somebody fix eighty rows over two sittings.
 * Re-mapping replaces EVERY row, because a different column mapping produces a
 * different set of entries — and that is only possible because the uploaded
 * file was kept.
 *
 * Both are refused once a run has been applied. A staged run has changed
 * nothing, so editing it costs nothing; an applied one has rows in real tables
 * that its staging rows are the record of.
 *
 * Every "the row now reads X" assertion below is preceded by a read of what the
 * row held BEFORE. "The corrected value is there" is true both when the repair
 * worked and when the row never carried the bad value, and only the second read
 * tells those two apart.
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
    BundleContact,
    EntityCounts,
    MigrationBundleV1,
} from '../../../server/lib/migration-intake/bundle';
import type { IntakeMapping } from '../../../server/lib/migration-intake/adapters/registry';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { MigrationRepairService } from '../../../server/services/migration-intake/repair.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const KEY = `${TENANT}/migrations/b1/source.csv`;

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

/**
 * The file the batch kept. Three columns, so a re-map has somewhere else to
 * point the name at — a mapping change nobody can see in the result would
 * prove nothing about whether the adapter ran again.
 *
 * The second row carries NOTHING but its name, on purpose: under the second
 * mapping neither of its mapped columns holds anything, which is the one
 * remaining reason a line is dropped rather than staged. The two mappings
 * therefore still produce a different NUMBER of entries as well as different
 * words. Without that, "how many entries this replaced" and "how many it
 * produced" would be the same number in every assertion, and a service that
 * reported the wrong one would be green.
 *
 * A blank BROKERAGE alone no longer does it. An entry with no name now stages
 * as a problem row instead of being lost, which is the change this file's
 * fixture had to move out of the way of.
 */
const CSV = [
    'Full Name,Email,Brokerage',
    'Alice Ng,alice@example.test,Acme Realty',
    'Bob Ray,,',
].join('\n');

/** What the operator started with: names from the name column. */
const KEEP_NAMES: IntakeMapping = {
    kind: 'contacts',
    mapping: { name: 'Full Name', email: 'Email', type: { fixed: 'client' } },
};

/** The operator decided the brokerage column was the name after all. */
const BROKERAGE_AS_NAME: IntakeMapping = {
    kind: 'contacts',
    mapping: { name: 'Brokerage', email: 'Email', type: { fixed: 'agent' } },
};

function bucketWith(entries: Record<string, string>) {
    const store = new Map(Object.entries(entries));
    return {
        put: vi.fn(async () => ({}) as R2Object),
        get: vi.fn(async (k: string) => (store.has(k)
            ? ({ text: async () => store.get(k) as string } as unknown as R2ObjectBody)
            : null)),
        delete: vi.fn(async () => undefined),
    };
}

/**
 * The manifest carries a STALE adapter version on purpose. The re-map runs the
 * real adapter, which reports `1`; without a difference to look at, "the batch
 * records what the re-run produced" would be green whether or not anything was
 * rewritten.
 */
function contactsBundle(list: BundleContact[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '0' },
            counts: {
                template: EMPTY,
                contact: { readFromSource: list.length, emitted: list.length, dropped: [] },
                member: EMPTY,
            },
            warnings: [{ code: 'STAGED_RUN', message: 'from the first mapping' }],
        },
        templates: [], contacts: list, members: [],
    };
}

describe('MigrationRepairService', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // Both services batch their writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    function svc(bucket = bucketWith({ [KEY]: CSV })) {
        return new MigrationRepairService({} as D1Database, bucket as unknown as R2Bucket);
    }

    async function stagedRun(over: { sourceKey?: string | null } = {}) {
        return stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            sourceKey: over.sourceKey === undefined ? KEY : over.sourceKey,
            bundle: contactsBundle([
                { name: 'Alice Ng', email: 'alice@example.test', type: 'client' },
                { name: 'Bob Ray', email: 'bob@example.test', type: 'client' },
            ]),
        });
    }

    function rowsOf(batchId: string) {
        return db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
    }

    function rowById(id: string) {
        return db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, id)).get();
    }

    function nameOf(row: { payload: string } | undefined): string | undefined {
        return row === undefined ? undefined : (JSON.parse(row.payload) as BundleContact).name;
    }

    describe('repairRow', () => {
        it('writes a repaired payload back in place and says the problem is gone', async () => {
            const staged = await stagedRun();
            const rowId = staged.rows[0]!.id;
            await db.update(schema.migrationRows)
                .set({ payload: JSON.stringify({ name: '', email: 'alice@example.test', type: 'client' }) })
                .where(eq(schema.migrationRows.id, rowId));

            // BEFORE: the row really is carrying the empty name. Without this
            // read, "the name is Alice Ng afterwards" would also be true of a
            // repair that did nothing to a row that was never broken.
            expect(nameOf(await rowById(rowId))).toBe('');

            const result = await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId,
                payload: { name: 'Alice Ng', email: 'alice@example.test', type: 'client' },
            });
            expect(result).toEqual({ resolved: true, problem: null });

            const row = await rowById(rowId);
            expect(nameOf(row)).toBe('Alice Ng');
            expect(row?.status).toBe('pending');
        });

        it('saves a half-repaired payload and hands back what is still wrong', async () => {
            const staged = await stagedRun();
            const rowId = staged.rows[0]!.id;
            // BEFORE: this row's address was fine, so the bad one below is the
            // edit's doing rather than something the run arrived with.
            expect(JSON.parse((await rowById(rowId))!.payload).email).toBe('alice@example.test');

            const result = await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId,
                payload: { name: 'Alice Ng', email: 'still-not-an-email', type: 'client' },
            });
            expect(result.resolved).toBe(false);
            expect(result.problem?.field).toBe('email');

            // Saved anyway: refusing would force every field to be right in one go.
            expect(JSON.parse((await rowById(rowId))!.payload).email).toBe('still-not-an-email');
        });

        it('recomputes the clash for the row it just changed, in both directions', async () => {
            await db.insert(schema.contacts).values({
                id: 'e1', tenantId: TENANT, type: 'client', name: 'Carol',
                email: 'carol@example.test', createdAt: new Date(),
            });
            const staged = await stagedRun();
            const rowId = staged.rows[0]!.id;
            // BEFORE: nothing to clash with.
            expect((await rowById(rowId))?.conflictWith).toBeNull();

            await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId,
                payload: { name: 'Alice Ng', email: 'carol@example.test', type: 'client' },
            });
            expect((await rowById(rowId))?.conflictWith).toBe('e1');

            // The other direction, so a finder that answers 'e1' to everything
            // cannot satisfy the assertion above on its own.
            await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId,
                payload: { name: 'Alice Ng', email: 'alice@example.test', type: 'client' },
            });
            expect((await rowById(rowId))?.conflictWith).toBeNull();
        });

        it('refuses to repair a row of another tenant batch', async () => {
            const staged = await stagedRun();
            await expect(svc().repairRow({
                tenantId: 'someone-else', batchId: staged.batchId, rowId: staged.rows[0]!.id,
                payload: { name: 'X', type: 'client' },
            })).rejects.toThrow(/not found/i);
            // The refusal did not write: the row still reads as it was staged.
            expect(nameOf(await rowById(staged.rows[0]!.id))).toBe('Alice Ng');
        });

        it('refuses an entry id that is not in this batch', async () => {
            const staged = await stagedRun();
            await expect(svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId: 'not-a-row',
                payload: { name: 'X', type: 'client' },
            })).rejects.toThrow(/not found/i);
        });

        it('refuses to repair a run that has been applied', async () => {
            const staged = await stagedRun();
            await db.update(schema.migrationBatches).set({ status: 'applied' })
                .where(eq(schema.migrationBatches.id, staged.batchId));
            await expect(svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId: staged.rows[0]!.id,
                payload: { name: 'X', type: 'client' },
            })).rejects.toThrow(/no longer being prepared/i);
        });

        it('refuses to repair a run that is only partly applied', async () => {
            // The dangerous one. Such a run has rows in real tables AND rows
            // still pending, so an edit here would rewrite the record of what
            // was already written.
            const staged = await stagedRun();
            await db.update(schema.migrationBatches).set({ status: 'partially_applied' })
                .where(eq(schema.migrationBatches.id, staged.batchId));
            await expect(svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId: staged.rows[0]!.id,
                payload: { name: 'X', type: 'client' },
            })).rejects.toThrow(/no longer being prepared/i);
        });
    });

    describe('remap', () => {
        it('re-reads the stored file and replaces every row', async () => {
            const staged = await stagedRun();
            const before = await rowsOf(staged.batchId);
            // BEFORE: the names came from the name column, and these are the
            // row ids. Both halves matter — the second is what tells a
            // replacement from an in-place rewrite.
            expect(before.map(nameOf).sort()).toEqual(['Alice Ng', 'Bob Ray']);
            const beforeIds = before.map((r) => r.id).sort();

            const result = await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS,
                mapping: BROKERAGE_AS_NAME,
            });
            // The two numbers differ, so neither can stand in for the other.
            expect(result).toEqual({ rowCount: 1, replacedRowCount: 2 });

            const after = await rowsOf(staged.batchId);
            expect(after).toHaveLength(1);
            expect(after.map(nameOf)).toEqual(['Acme Realty']);
            expect(after.map((r) => JSON.parse(r.payload).type)).toEqual(['agent']);
            expect(after.every((r) => r.status === 'pending')).toBe(true);
            // Old rows are gone, not appended to and not edited in place.
            expect(beforeIds).not.toContain(after[0]!.id);
            expect(after.map((r) => r.position)).toEqual([0]);
        });

        it('records what the re-run dropped, not what the staged run dropped', async () => {
            const staged = await stagedRun();
            // BEFORE: the staged manifest says nothing was lost.
            const before = await db.select().from(schema.migrationBatches)
                .where(eq(schema.migrationBatches.id, staged.batchId)).get();
            expect(JSON.parse(before!.manifest).counts.contact.dropped).toEqual([]);

            await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS,
                mapping: BROKERAGE_AS_NAME,
            });

            const after = await db.select().from(schema.migrationBatches)
                .where(eq(schema.migrationBatches.id, staged.batchId)).get();
            const counts = JSON.parse(after!.manifest).counts.contact;
            expect(counts.readFromSource).toBe(2);
            expect(counts.emitted).toBe(1);
            expect(counts.dropped).toEqual([
                { at: 'line 3', reason: 'every mapped column is empty on this line' },
            ]);
        });

        it('records the provenance the re-run produced, not the one it replaced', async () => {
            const staged = await stagedRun();
            const before = await db.select().from(schema.migrationBatches)
                .where(eq(schema.migrationBatches.id, staged.batchId)).get();
            // BEFORE: the staged manifest, stale version and all.
            expect(before?.adapterVersion).toBe('0');
            expect(JSON.parse(before!.manifest).warnings).toHaveLength(1);

            await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: KEEP_NAMES,
            });

            const after = await db.select().from(schema.migrationBatches)
                .where(eq(schema.migrationBatches.id, staged.batchId)).get();
            expect(after?.adapterVersion).toBe('1');
            expect(after?.adapterName).toBe('csv-generic');
            expect(after?.vendor).toBe('csv_generic');
            const manifest = JSON.parse(after!.manifest);
            expect(manifest.warnings).toEqual([]);
            expect(manifest.counts.contact).toEqual({ readFromSource: 2, emitted: 2, dropped: [] });
        });

        it('refuses to re-map when the stored file is no longer there', async () => {
            const staged = await stagedRun();
            await expect(svc(bucketWith({})).remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: KEEP_NAMES,
            })).rejects.toThrow(/no longer stored/i);
            expect(await rowsOf(staged.batchId)).toHaveLength(2);
        });

        it('refuses to re-map a run that kept no file at all', async () => {
            const staged = await stagedRun({ sourceKey: null });
            await expect(svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: KEEP_NAMES,
            })).rejects.toThrow(/did not keep its file/i);
        });

        it('refuses to re-map a run that has been applied', async () => {
            const staged = await stagedRun();
            await db.update(schema.migrationBatches).set({ status: 'applied' })
                .where(eq(schema.migrationBatches.id, staged.batchId));
            await expect(svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: KEEP_NAMES,
            })).rejects.toThrow(/no longer being prepared/i);
        });

        it('refuses to re-map a run that is only partly applied, and leaves its rows alone', async () => {
            // Replacing the rows of a partly-applied run is the double-apply
            // vector: the rows recording what was already written would be
            // swapped for fresh pending ones, and finishing the run would
            // create every entry a second time.
            const staged = await stagedRun();
            await db.update(schema.migrationRows)
                .set({ status: 'applied', createdId: 'made-1' })
                .where(eq(schema.migrationRows.id, staged.rows[0]!.id));
            await db.update(schema.migrationBatches).set({ status: 'partially_applied' })
                .where(eq(schema.migrationBatches.id, staged.batchId));

            await expect(svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: BROKERAGE_AS_NAME,
            })).rejects.toThrow(/no longer being prepared/i);

            const after = await rowsOf(staged.batchId);
            expect(after).toHaveLength(2);
            expect(after.map(nameOf).sort()).toEqual(['Alice Ng', 'Bob Ray']);
            expect(after.find((r) => r.id === staged.rows[0]!.id)?.createdId).toBe('made-1');
        });

        it('refuses to re-map another tenant batch', async () => {
            const staged = await stagedRun();
            await expect(svc().remap({
                tenantId: 'someone-else', batchId: staged.batchId, limits: LIMITS, mapping: KEEP_NAMES,
            })).rejects.toThrow(/not found/i);
        });

        it('refuses a mapping that describes a different family from the one the run imports', async () => {
            // Otherwise a contact import could be re-mapped into a staff
            // invite, and applying it would spend seats the operator never
            // asked to spend.
            const staged = await stagedRun();
            await expect(svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS,
                mapping: { kind: 'members', mapping: { email: 'Email', role: { fixed: 'inspector' } } },
            })).rejects.toThrow(/brings in contacts/i);

            const after = await rowsOf(staged.batchId);
            expect(after.every((r) => r.entity === 'contact')).toBe(true);
            expect(after).toHaveLength(2);
        });

        it('refuses to re-map a run whose file was converted for it', async () => {
            // An assisted run's file is one no adapter here could read. Running
            // one over it now would either fail or, worse, half-read it.
            const { batchId } = await stage.createAssistanceBatch({
                tenantId: TENANT, createdBy: USER, intent: 'assisted.full',
                sourceKey: KEY, expiresAt: new Date(Date.now() + 86_400_000),
                uploadAuthorizedBy: USER, staffAccessAuthorizedBy: USER,
            });
            await stage.stageIntoBatch({
                tenantId: TENANT, batchId, limits: LIMITS,
                bundle: contactsBundle([{ name: 'Delivered', email: 'd@example.test', type: 'client' }]),
            });

            await expect(svc().remap({
                tenantId: TENANT, batchId, limits: LIMITS, mapping: KEEP_NAMES,
            })).rejects.toThrow(/converted for you/i);
            expect(await rowsOf(batchId)).toHaveLength(1);
        });

        it('reports the adapter error rather than half-replacing the rows', async () => {
            const staged = await stagedRun();
            const beforeIds = (await rowsOf(staged.batchId)).map((r) => r.id).sort();

            await expect(svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS,
                mapping: { kind: 'contacts', mapping: { name: 'Nope', type: { fixed: 'client' } } },
            })).rejects.toThrow(/Nope/);

            const after = await rowsOf(staged.batchId);
            expect(after).toHaveLength(2);
            expect(after.map((r) => r.id).sort()).toEqual(beforeIds);
            expect(after.map(nameOf).sort()).toEqual(['Alice Ng', 'Bob Ray']);
        });
    });

    /**
     * Running the same staged batch a second time.
     *
     * Two hazards, in both directions: a second run must not leave two sets of
     * rows behind for apply to consume, and it must not throw away an operator's
     * correction without saying so.
     */
    describe('running a staged batch again', () => {
        it('leaves one set of rows after re-mapping twice, not two', async () => {
            const staged = await stagedRun();
            await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: BROKERAGE_AS_NAME,
            });
            expect(await rowsOf(staged.batchId)).toHaveLength(1);

            const second = await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: KEEP_NAMES,
            });
            // One went out, two came in. Appending would leave three.
            expect(second).toEqual({ rowCount: 2, replacedRowCount: 1 });

            const after = await rowsOf(staged.batchId);
            expect(after).toHaveLength(2);
            expect(after.map(nameOf).sort()).toEqual(['Alice Ng', 'Bob Ray']);
        });

        it('says how many entries a re-map removed, so a discarded repair is not silent', async () => {
            const staged = await stagedRun();
            const rowId = staged.rows[0]!.id;
            await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId,
                payload: { name: 'Hand Corrected', email: 'alice@example.test', type: 'client' },
            });
            // BEFORE: the correction is really in the table, so its absence
            // afterwards is the re-map's doing.
            expect(nameOf(await rowById(rowId))).toBe('Hand Corrected');

            const result = await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: BROKERAGE_AS_NAME,
            });
            // The count is the whole point: a caller that can say "this
            // replaces the 2 entries you have" is not discarding it silently.
            // It is the count of what WENT, which here is not the count of what
            // arrived.
            expect(result.replacedRowCount).toBe(2);
            expect(result.rowCount).toBe(1);

            const after = await rowsOf(staged.batchId);
            expect(after.map(nameOf)).not.toContain('Hand Corrected');
            expect(await rowById(rowId)).toBeUndefined();
        });

        it('refuses a repair aimed at an entry the re-map removed', async () => {
            const staged = await stagedRun();
            const staleRowId = staged.rows[0]!.id;
            await svc().remap({
                tenantId: TENANT, batchId: staged.batchId, limits: LIMITS, mapping: BROKERAGE_AS_NAME,
            });

            await expect(svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId: staleRowId,
                payload: { name: 'Resurrected', email: 'alice@example.test', type: 'client' },
            })).rejects.toThrow(/not found/i);
            expect(await rowsOf(staged.batchId)).toHaveLength(1);
            expect((await rowsOf(staged.batchId)).map(nameOf)).not.toContain('Resurrected');

            // Positive control: an id the re-map DID produce is repairable, so
            // the refusal above is about the stale id and not about repair
            // being broken after a re-map.
            const live = (await rowsOf(staged.batchId))[0]!;
            const ok = await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId: live.id,
                payload: { name: 'Acme Realty', email: 'alice@example.test', type: 'agent' },
            });
            expect(ok.resolved).toBe(true);
            expect(nameOf(await rowById(live.id))).toBe('Acme Realty');
        });

        it('clears an outcome the previous run left on the entry it repairs', async () => {
            // A failed apply writes a sentence onto the row. Leaving it there
            // after a repair would make the next report show the reason the
            // entry USED to be unwritable.
            const staged = await stagedRun();
            const rowId = staged.rows[0]!.id;
            await db.update(schema.migrationRows)
                .set({ status: 'failed', outcome: 'UNIQUE constraint failed' })
                .where(eq(schema.migrationRows.id, rowId));
            expect((await rowById(rowId))?.outcome).toBe('UNIQUE constraint failed');

            await svc().repairRow({
                tenantId: TENANT, batchId: staged.batchId, rowId,
                payload: { name: 'Alice Ng', email: 'alice2@example.test', type: 'client' },
            });
            const row = await rowById(rowId);
            expect(row?.outcome).toBeNull();
            expect(row?.status).toBe('pending');
        });

        it('touches no other batch of the same tenant', async () => {
            const first = await stagedRun();
            const second = await stagedRun();
            await svc().remap({
                tenantId: TENANT, batchId: second.batchId, limits: LIMITS, mapping: BROKERAGE_AS_NAME,
            });
            expect((await rowsOf(first.batchId)).map(nameOf).sort()).toEqual(['Alice Ng', 'Bob Ray']);
            // Two untouched in the first run, one produced in the second.
            expect(await db.select().from(schema.migrationRows)
                .where(and(
                    eq(schema.migrationRows.tenantId, TENANT),
                    eq(schema.migrationRows.status, 'pending'),
                )).all()).toHaveLength(3);
        });
    });
});
