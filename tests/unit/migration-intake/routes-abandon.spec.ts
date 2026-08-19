/**
 * Throwing a run away, and the gate that has to be re-asked before it goes.
 *
 * The per-intent gate is asserted HERE rather than on the route that created
 * the run, because that is the claim the module makes and the one a
 * service-level test cannot see: every route re-checks the run's own intent,
 * so an actor whose capabilities changed between the upload and the apply is
 * refused at the second door as well as the first.
 *
 * Abandon is where "nothing changed" is most misleading — a refused delete and
 * a delete that never ran both leave the run in place — so each refusal reads
 * back the batch row, its entries AND the stored file.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { withBatch } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
    OTHER,
    TENANT,
    USER,
    contactsBundle,
    intakeRequest,
    jsonBody,
    messageOf,
    seedIntakeTenant,
    stageIntakeRun,
    type StagedFixture,
} from '../helpers/migration-intake-routes-harness';
import { MIGRATION_BATCH_STATUS } from '../../../server/lib/status/migration-batch-status';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { r2Keys } from '../../../server/lib/r2-keys';

describe('abandoning a run', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let store: Map<string, string>;
    let run: StagedFixture;

    async function batchRow() {
        return db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, run.batchId)).get();
    }

    async function markNeedsAssistance(): Promise<void> {
        await db.update(schema.migrationBatches)
            .set({ status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE })
            .where(eq(schema.migrationBatches.id, run.batchId));
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(withBatch(db, fix.sqlite));
        store = new Map();
        await seedIntakeTenant(db);
        await seedIntakeTenant(db, OTHER);
        run = await stageIntakeRun(db, store, {
            intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice Ng', email: 'alice@example.test' },
                { name: 'Bob Ray', email: 'bob@example.test' },
            ]),
        });
    });

    describe('DELETE /api/imports/{batchId}', () => {
        function abandon(opts: { role?: string; tenantId?: string } = {}) {
            return intakeRequest({ store, ...opts }, `/api/imports/${run.batchId}`, { method: 'DELETE' });
        }

        it('takes the run, its entries and its file with it', async () => {
            const res = await abandon();
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ success: true, data: { deleted: true } });
            expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
            expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
            expect([...store.keys()]).toEqual([]);
        });

        it('also abandons a run that was waiting for a person', async () => {
            // The second member of the deletable list, asserted rather than
            // assumed: a list of one that reads as a list of two is exactly the
            // shape nobody notices.
            await markNeedsAssistance();
            const res = await abandon();
            expect(res.status).toBe(200);
            expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
        });

        it('refuses to delete a run that has been applied, and deletes nothing', async () => {
            await intakeRequest(
                { store }, `/api/imports/${run.batchId}/apply`, jsonBody({ conflictPolicy: 'skip' }),
            );
            const res = await abandon();
            expect(res.status).toBe(409);
            expect(await messageOf(res)).toBe(
                'This import has been applied. Its entries are the only record of where the imported '
                + 'rows came from, so undo it instead.',
            );
            // Three separate things the refusal has to have left alone.
            expect(await batchRow()).toBeDefined();
            expect(await db.select().from(schema.migrationRows).all()).toHaveLength(2);
            expect([...store.keys()]).toEqual([run.sourceKey]);
            expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
        });

        it('does not delete another workspace\'s run', async () => {
            const res = await abandon({ tenantId: OTHER });
            expect(res.status).toBe(404);
            expect(await messageOf(res)).toBe('Migration batch not found');
            expect(await batchRow()).toBeDefined();
            expect([...store.keys()]).toEqual([run.sourceKey]);
        });

        it('keeps an inspector out of abandon', async () => {
            const res = await abandon({ role: 'inspector' });
            expect(res.status).toBe(403);
            expect(await messageOf(res)).toBe('Requires one of [owner, manager]');
            expect(await batchRow()).toBeDefined();
        });
    });
});

describe('the per-intent gate is re-applied on every route, not only on the upload', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let store: Map<string, string>;
    let batchId: string;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(withBatch(db, fix.sqlite));
        store = new Map();
        await seedIntakeTenant(db);
        const sourceKey = r2Keys.migrationSource(TENANT, 'waiting', 'csv');
        store.set(sourceKey, 'PK binary rubbish');
        const created = await new MigrationStageService({} as D1Database).createAssistanceBatch({
            tenantId: TENANT,
            createdBy: USER,
            intent: 'assisted.full',
            sourceKey,
            expiresAt: new Date(Date.now() + 86_400_000),
            uploadAuthorizedBy: USER,
            staffAccessAuthorizedBy: USER,
        });
        batchId = created.batchId;
    });

    it('refuses a manager on a run whose intent only an owner may run', async () => {
        const res = await intakeRequest(
            { store, role: 'manager' }, `/api/imports/${batchId}`, { method: 'DELETE' },
        );
        expect(res.status).toBe(403);
        // The route's own floor admits a manager, so this sentence is the only
        // evidence that the run's intent was consulted a second time.
        expect(await messageOf(res)).toBe('Only an owner can send a file to be converted.');
        expect(await db.select().from(schema.migrationBatches).all()).toHaveLength(1);
    });

    it('lets an owner through the same door', async () => {
        const res = await intakeRequest({ store }, `/api/imports/${batchId}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
    });
});
