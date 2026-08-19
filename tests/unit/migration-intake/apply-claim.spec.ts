/**
 * Who is allowed to start applying a batch.
 *
 * A double click, or two administrators pressing the button at the same moment,
 * are two executions of the same run. The claim is a CONDITIONAL update, and a
 * zero-row result is the refusal — checking the status first and writing it
 * second is the same race written more slowly.
 *
 * The claim is not what prevents duplicate writes. Row status is: apply only
 * consumes pending rows, so a row that already landed is never written twice.
 * The claim stops two executors interleaving. These are kept separate here
 * because treating them as one thing leads a reader to believe a lost claim
 * means duplicated data.
 *
 * A batch stuck in `applying` because its worker died can be claimed again
 * after a stale window — safe for the same reason.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import type { EntityCounts, MigrationBundleV1 } from '../../../server/lib/migration-intake/bundle';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';
// Read, never restated. A test that wrote `5 * 60 * 1000` of its own would keep
// passing after the window moved, and would be asserting its own arithmetic.
import { APPLY_CLAIM_STALE_MS } from '../../../server/lib/migration-intake/apply-claim';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { MIGRATION_INTAKE_STAGED_RETENTION_DAYS } from '../../../server/lib/compliance/retention-windows';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function contactsBundle(count: number): MigrationBundleV1 {
    const contacts = Array.from({ length: count }, (_, i) => ({
        name: `P${i}`, email: `p${i}@example.test`, type: 'client' as const,
    }));
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: EMPTY,
                contact: { readFromSource: count, emitted: count, dropped: [] },
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [], contacts, members: [],
    };
}

describe('apply claims the batch before consuming it', () => {
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

    async function staged(count = 1) {
        const r = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(count), limits: LIMITS,
        });
        return r.batchId;
    }

    function batchRow(batchId: string) {
        return db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, batchId)).get();
    }

    it('refuses a batch somebody else is already applying, and says so', async () => {
        const batchId = await staged();
        const claimedAt = new Date(Date.now() - 1000);
        await db.update(schema.migrationBatches)
            .set({ status: 'applying', appliedAt: claimedAt })
            .where(eq(schema.migrationBatches.id, batchId));

        await expect(apply.apply({
            tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        })).rejects.toThrow(/already being applied|has already been applied/i);

        expect(await db.select().from(schema.contacts).all()).toEqual([]);
        // A refused claim leaves the other executor's run exactly as it was.
        // Half-moving it — restamping the claim instant, or writing this run's
        // conflict policy onto somebody else's run — would make the batch read
        // as if this execution had taken it after all.
        const after = await batchRow(batchId);
        expect(after?.status).toBe('applying');
        expect(after?.appliedAt?.getTime()).toBe(claimedAt.getTime());
        expect(after?.conflictPolicy).toBeNull();
        // And the rows it was going to consume are untouched.
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
        expect(rows.every((r) => r.status === 'pending')).toBe(true);
    });

    it('refuses a batch that has already finished', async () => {
        const batchId = await staged();
        await apply.apply({ tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false });
        await expect(apply.apply({
            tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        })).rejects.toThrow(/already being applied|has already been applied/i);
        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);
        expect((await batchRow(batchId))?.status).toBe('applied');
    });

    it('reopens the undo window when it finishes, rather than inheriting the upload clock', async () => {
        const batchId = await staged();
        // A run staged long ago: its original clock is nearly out. Staging set
        // it to keep an unfinished run from sitting forever; once the run has
        // been applied that same column is measuring something else — how long
        // the entries the undo reads are kept. Leaving it where it was would
        // give a run applied on day twenty-nine a one-day undo.
        const nearlyOut = new Date(Date.now() + 60_000);
        await db.update(schema.migrationBatches)
            .set({ expiresAt: nearlyOut })
            .where(eq(schema.migrationBatches.id, batchId));
        // The before-state, asserted rather than assumed: without it a passing
        // test could be reading a clock apply never touched.
        expect((await batchRow(batchId))?.expiresAt?.getTime()).toBe(nearlyOut.getTime());

        await apply.apply({ tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false });

        const batch = await batchRow(batchId);
        const days = ((batch?.expiresAt?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(MIGRATION_INTAKE_STAGED_RETENTION_DAYS - 1);
        // One instant for the whole run, not two: `applied_at` and the new due
        // date describe the same event, and a second `new Date()` would put
        // milliseconds between them for no reason a reader could recover.
        expect(batch?.expiresAt?.getTime())
            .toBe((batch?.appliedAt?.getTime() ?? 0) + MIGRATION_INTAKE_STAGED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    });

    it('lets a batch whose executor died be claimed again after the stale window', async () => {
        const batchId = await staged();
        await db.update(schema.migrationBatches)
            .set({ status: 'applying', appliedAt: new Date(Date.now() - APPLY_CLAIM_STALE_MS - 1000) })
            .where(eq(schema.migrationBatches.id, batchId));

        const result = await apply.apply({
            tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 1 });
    });

    it('does not reclaim one that has only just started', async () => {
        const batchId = await staged();
        await db.update(schema.migrationBatches)
            .set({ status: 'applying', appliedAt: new Date(Date.now() - 1000) })
            .where(eq(schema.migrationBatches.id, batchId));
        await expect(apply.apply({
            tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        })).rejects.toThrow(/already being applied|has already been applied/i);
        expect(await db.select().from(schema.contacts).all()).toEqual([]);
    });

    it('claims a partially applied batch, because that is what resuming is', async () => {
        // Half a run landed and half failed. Pressing the button again is a
        // resumption, not a second execution — and the claim has to let it
        // through or the failed half could never be retried.
        const batchId = await staged(2);
        await db.update(schema.migrationBatches)
            .set({ status: 'partially_applied', appliedAt: new Date(Date.now() - 1000) })
            .where(eq(schema.migrationBatches.id, batchId));

        const result = await apply.apply({
            tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 2 });
    });

    it('leaves the batch staged when a whole-batch check refuses before the claim', async () => {
        // A seat shortfall is decided before anything is claimed, so a refused
        // run is still a run the operator can fix and retry — not one parked in
        // a state that reads like work in progress.
        await db.update(schema.tenants).set({ maxUsers: 1 }).where(eq(schema.tenants.id, TENANT));
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: 'boss@example.test', passwordHash: 'x',
            role: 'owner', createdAt: new Date(),
        });
        const r = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite', limits: LIMITS,
            bundle: {
                formatVersion: 1,
                manifest: {
                    source: { vendor: 'csv_generic' },
                    adapter: { name: 'csv-generic', version: '1' },
                    counts: {
                        template: EMPTY,
                        contact: EMPTY,
                        member: { readFromSource: 2, emitted: 2, dropped: [] },
                    },
                    warnings: [],
                },
                templates: [], contacts: [],
                members: [
                    { email: 'a@example.test', role: 'inspector' },
                    { email: 'b@example.test', role: 'inspector' },
                ],
            },
        });
        await expect(apply.apply({
            tenantId: TENANT, batchId: r.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        })).rejects.toThrow(/seats/i);

        const batch = await batchRow(r.batchId);
        expect(batch?.status).toBe('staged');
        expect(batch?.appliedAt).toBeNull();
    });
});
