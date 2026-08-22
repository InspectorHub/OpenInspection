/**
 * Editing a run that has not been applied, over HTTP.
 *
 * Two operations, and the thing they have in common is what these assertions
 * are for: both are legal ONLY while the run is still being prepared, and both
 * refuse with a status code that several other guards on the same route also
 * answer. So every refusal here is asserted on its own SENTENCE, and every
 * refusal is paired with a positive control — the same request with the single
 * blocking condition lifted.
 *
 * A re-map that did nothing and a re-map that was refused leave the same
 * response code and the same row count, so the rows themselves are read back
 * rather than the status alone.
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
    contactsBundle,
    intakeRequest,
    jsonBody,
    messageOf,
    seedIntakeTenant,
    stageIntakeRun,
    type StagedFixture,
} from '../helpers/migration-intake-routes-harness';
import { MIGRATION_BATCH_STATUS } from '../../../server/lib/status/migration-batch-status';

const CONTACT_MAPPING = { kind: 'contacts', mapping: { name: 'Email', type: { fixed: 'agent' } } };
const MEMBER_MAPPING = { kind: 'members', mapping: { email: 'Email', role: { fixed: 'inspector' } } };

describe('editing an import run over HTTP', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let store: Map<string, Uint8Array>;
    let run: StagedFixture;

    /** The names as they stand in the run right now — the only proof a re-map ran. */
    async function stagedNames(): Promise<string[]> {
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, run.batchId)).all();
        return rows.map((r) => (JSON.parse(r.payload) as { name: string }).name).sort();
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

    describe('PATCH /api/imports/{batchId}/mapping', () => {
        it('rebuilds every entry from the stored file and says what it replaced', async () => {
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/mapping`,
                jsonBody({ mapping: CONTACT_MAPPING }, 'PATCH'),
            );
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { rowCount: number; replacedRowCount: number } };
            expect(body.data).toEqual({ rowCount: 2, replacedRowCount: 2 });
            // The mapping put the EMAIL column into the name field. Reading the
            // rows back is what separates "the new mapping was applied" from
            // "the route answered 200 and changed nothing".
            expect(await stagedNames()).toEqual(['alice@example.test', 'bob@example.test']);
        });

        it('does not re-map a run belonging to another workspace, and leaves its entries alone', async () => {
            const res = await intakeRequest(
                { store, tenantId: OTHER }, `/api/imports/${run.batchId}/mapping`,
                jsonBody({ mapping: CONTACT_MAPPING }, 'PATCH'),
            );
            expect(res.status).toBe(404);
            expect(await messageOf(res)).toBe('Migration batch not found');
            // The SAME id succeeds for the tenant that owns it in the test
            // above, so this is scoping rather than a bad id.
            expect(await stagedNames()).toEqual(['Alice Ng', 'Bob Ray']);
        });

        it('refuses to re-map a run that has been applied, naming that as the reason', async () => {
            await db.update(schema.migrationBatches)
                .set({ status: MIGRATION_BATCH_STATUS.APPLIED })
                .where(eq(schema.migrationBatches.id, run.batchId));
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/mapping`,
                jsonBody({ mapping: CONTACT_MAPPING }, 'PATCH'),
            );
            expect(res.status).toBe(409);
            expect(await messageOf(res))
                .toBe('This import is no longer being prepared, so it cannot be changed.');
            // 409 is also what a missing file answers. The entries prove which.
            expect(await stagedNames()).toEqual(['Alice Ng', 'Bob Ray']);
        });

        it('refuses a mapping that describes a different family from the one the run imports', async () => {
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/mapping`,
                jsonBody({ mapping: MEMBER_MAPPING }, 'PATCH'),
            );
            expect(res.status).toBe(400);
            expect(await messageOf(res))
                .toBe('This import brings in contacts, so its mapping has to describe contacts.');
            expect(await stagedNames()).toEqual(['Alice Ng', 'Bob Ray']);
        });

        it('refuses to re-map once the stored file has gone, and says so', async () => {
            store.delete(run.sourceKey);
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/mapping`,
                jsonBody({ mapping: CONTACT_MAPPING }, 'PATCH'),
            );
            expect(res.status).toBe(409);
            expect(await messageOf(res)).toBe(
                'This import\'s file is no longer stored, so the mapping cannot be changed. Start the import again.',
            );
        });

        it('keeps an inspector out of the re-map', async () => {
            const res = await intakeRequest(
                { store, role: 'inspector' }, `/api/imports/${run.batchId}/mapping`,
                jsonBody({ mapping: CONTACT_MAPPING }, 'PATCH'),
            );
            expect(res.status).toBe(403);
            expect(await messageOf(res)).toBe('Requires one of [owner, manager]');
        });
    });

    describe('PATCH /api/imports/{batchId}/rows/{rowId}', () => {
        it('saves a correction that is still incomplete and names what is left wrong', async () => {
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/rows/${run.rowIds[0]}`,
                jsonBody({ payload: { name: 'Alice Ng', email: 'nope', type: 'client' } }, 'PATCH'),
            );
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { resolved: boolean; problem: { field: string } | null } };
            expect(body.data.resolved).toBe(false);
            expect(body.data.problem?.field).toBe('email');
            // Saved ANYWAY. Refusing a partial fix would mean every field of a
            // broken entry has to be right in one go.
            const row = await db.select().from(schema.migrationRows)
                .where(eq(schema.migrationRows.id, run.rowIds[0])).get();
            expect(JSON.parse(row?.payload ?? '{}')).toMatchObject({ email: 'nope' });
        });

        it('reports an entry that is now importable as resolved', async () => {
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/rows/${run.rowIds[0]}`,
                jsonBody({ payload: { name: 'Alice Ng', email: 'alice@example.test', type: 'client' } }, 'PATCH'),
            );
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { resolved: boolean; problem: unknown } };
            expect(body.data).toEqual({ resolved: true, problem: null });
        });

        it('404s an entry that is not in this run', async () => {
            const res = await intakeRequest(
                { store }, `/api/imports/${run.batchId}/rows/not-a-row`,
                jsonBody({ payload: { name: 'Alice Ng', email: 'alice@example.test', type: 'client' } }, 'PATCH'),
            );
            expect(res.status).toBe(404);
            // Its own sentence: the batch-level 404 next door reads differently,
            // and telling them apart is how an operator knows what to fix.
            expect(await messageOf(res)).toBe('Import entry not found');
        });

        it('does not repair an entry in another workspace\'s run', async () => {
            const res = await intakeRequest(
                { store, tenantId: OTHER }, `/api/imports/${run.batchId}/rows/${run.rowIds[0]}`,
                jsonBody({ payload: { name: 'Mallory', email: 'mallory@example.test', type: 'client' } }, 'PATCH'),
            );
            expect(res.status).toBe(404);
            expect(await messageOf(res)).toBe('Migration batch not found');
            expect(await stagedNames()).toEqual(['Alice Ng', 'Bob Ray']);
        });
    });
});

describe('the tenant that owns the run reaches it', () => {
    it('is the same id, and it answers', async () => {
        // The positive control for every 404 above, kept apart from them so the
        // fixture cannot quietly stop staging anything at all.
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(withBatch(fix.db, fix.sqlite));
        const store = new Map<string, Uint8Array>();
        await seedIntakeTenant(fix.db);
        const run = await stageIntakeRun(fix.db, store, {
            intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice Ng', email: 'alice@example.test' }]),
        });
        const res = await intakeRequest(
            { store, tenantId: TENANT }, `/api/imports/${run.batchId}/rows/${run.rowIds[0]}`,
            jsonBody({ payload: { name: 'Alice Ng', email: 'alice@example.test', type: 'client' } }, 'PATCH'),
        );
        expect(res.status).toBe(200);
    });
});
