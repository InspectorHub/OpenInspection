/**
 * Running a prepared run, and taking it back.
 *
 * The apply route is the only place in this module that both writes to real
 * tables and sends mail, and the two are deliberately not the same event: an
 * invitation whose email did not go out is still an invitation, its seat is
 * still taken, and pressing apply again would skip the row and send nothing.
 * So the response prints BOTH numbers rather than reporting a clean success,
 * and this spec asserts the row survives the failed send.
 *
 * "The batch did not change" is true both when a guard worked and when the
 * operation was never attempted, so every refusal below reads back the batch
 * status and the real table as well as the status code.
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
    contactsBundle,
    intakeRequest,
    jsonBody,
    membersBundle,
    messageOf,
    seedIntakeTenant,
    stageIntakeRun,
    type StagedFixture,
} from '../helpers/migration-intake-routes-harness';
import { MIGRATION_BATCH_STATUS } from '../../../server/lib/status/migration-batch-status';

interface ApplyBody {
    data: {
        status: string;
        applied: number;
        skipped: number;
        failed: number;
        invitesSent: number;
        invitesFailed: number;
    };
}

describe('applying and undoing an import run over HTTP', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let store: Map<string, string>;
    let run: StagedFixture;

    async function batchStatus(): Promise<string | undefined> {
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, run.batchId)).get();
        return batch?.status;
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

    function apply(opts: { role?: string; tenantId?: string; sendInvitation?: () => Promise<void> } = {}) {
        return intakeRequest(
            { store, ...opts }, `/api/imports/${run.batchId}/apply`,
            jsonBody({ conflictPolicy: 'skip' }),
        );
    }

    describe('POST /api/imports/{batchId}/apply', () => {
        it('writes the entries and prints all five numbers side by side', async () => {
            const res = await apply();
            expect(res.status).toBe(200);
            const body = await res.json() as ApplyBody;
            expect(body.data).toEqual({
                status: MIGRATION_BATCH_STATUS.APPLIED,
                applied: 2, skipped: 0, failed: 0, invitesSent: 0, invitesFailed: 0,
            });
            expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
        });

        it('refuses a second apply by name, and does not write the entries twice', async () => {
            await apply();
            const res = await apply();
            expect(res.status).toBe(409);
            expect(await messageOf(res))
                .toBe('This import is already being applied, or has already been applied.');
            // The refusal and a no-op leave the same status code. These two do not.
            expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.APPLIED);
        });

        it('does not apply a run belonging to another workspace', async () => {
            const res = await apply({ tenantId: OTHER });
            expect(res.status).toBe(404);
            expect(await messageOf(res)).toBe('Migration batch not found');
            expect(await db.select().from(schema.contacts).all()).toEqual([]);
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.STAGED);
        });

        it('keeps an inspector out of apply', async () => {
            const res = await apply({ role: 'inspector' });
            expect(res.status).toBe(403);
            expect(await messageOf(res)).toBe('Requires one of [owner, manager]');
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.STAGED);
        });

        it('lets a manager apply — the positive control for the two refusals above', async () => {
            const res = await apply({ role: 'manager' });
            expect(res.status).toBe(200);
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.APPLIED);
        });
    });

    describe('the invitations an apply sends', () => {
        let inviteRun: StagedFixture;

        beforeEach(async () => {
            inviteRun = await stageIntakeRun(db, store, {
                intent: 'members.invite',
                bundle: membersBundle([{ email: 'newhire@example.test', role: 'inspector' }]),
            });
        });

        function applyInvites(sendInvitation?: (to: string, link: string) => Promise<void>) {
            return intakeRequest(
                { store, ...(sendInvitation ? { sendInvitation } : {}) },
                `/api/imports/${inviteRun.batchId}/apply`,
                jsonBody({ conflictPolicy: 'skip' }),
            );
        }

        it('counts an invitation that went out', async () => {
            const sent: string[] = [];
            const res = await applyInvites(async (to) => { sent.push(to); });
            expect(res.status).toBe(200);
            const body = await res.json() as ApplyBody;
            expect(body.data).toMatchObject({ applied: 1, invitesSent: 1, invitesFailed: 0 });
            expect(sent).toEqual(['newhire@example.test']);
            expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(1);
        });

        it('counts a failed delivery WITHOUT taking the invitation back', async () => {
            const res = await applyInvites(async () => { throw new Error('provider down'); });
            expect(res.status).toBe(200);
            const body = await res.json() as ApplyBody;
            expect(body.data).toMatchObject({
                status: MIGRATION_BATCH_STATUS.APPLIED,
                applied: 1, invitesSent: 0, invitesFailed: 1,
            });
            // The whole point of printing two numbers: the seat is taken and
            // the invitation is live, so a re-apply would skip the row and send
            // nothing. Resending is the team page's action, not this route's.
            expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(1);
        });
    });

    describe('POST /api/imports/{batchId}/revert', () => {
        function revert(opts: { role?: string; tenantId?: string } = {}) {
            return intakeRequest({ store, ...opts }, `/api/imports/${run.batchId}/revert`, { method: 'POST' });
        }

        it('takes back everything the run created', async () => {
            await apply();
            const res = await revert();
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { status: string; reverted: number; refused: unknown[] } };
            expect(body.data).toEqual({
                status: MIGRATION_BATCH_STATUS.REVERTED, reverted: 2, refused: [],
            });
            expect(await db.select().from(schema.contacts).all()).toEqual([]);
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.REVERTED);
        });

        it('refuses to undo a run that was never applied, and says which of the two it is', async () => {
            const res = await revert();
            expect(res.status).toBe(400);
            expect(await messageOf(res))
                .toBe('This import has not been applied, so there is nothing to undo.');
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.STAGED);
        });

        it('refuses to undo a run that has already been undone, with the other sentence', async () => {
            await apply();
            await revert();
            const res = await revert();
            expect(res.status).toBe(400);
            expect(await messageOf(res)).toBe('This import has already been undone.');
        });

        it('does not undo a run belonging to another workspace', async () => {
            await apply();
            const res = await revert({ tenantId: OTHER });
            expect(res.status).toBe(404);
            expect(await messageOf(res)).toBe('Migration batch not found');
            expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
            expect(await batchStatus()).toBe(MIGRATION_BATCH_STATUS.APPLIED);
        });

        it('keeps an inspector out of revert', async () => {
            await apply();
            const res = await revert({ role: 'inspector' });
            expect(res.status).toBe(403);
            expect(await messageOf(res)).toBe('Requires one of [owner, manager]');
            expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
        });
    });
});
