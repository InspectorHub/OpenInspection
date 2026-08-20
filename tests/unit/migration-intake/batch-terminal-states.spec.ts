/**
 * What is left of an import run after its clock runs out.
 *
 * Not nothing. The staged entries and the uploaded file hold a third party's
 * name, email address and phone number, so those go — but the batch row itself
 * holds ids, timestamps, a vendor name, and two authorisations given by this
 * workspace's own people. Deleting it too would mean a run simply vanishes,
 * with no way to tell "it was cleared" from "it never happened", and it would
 * leave a status value nothing can ever write.
 *
 * Which value it lands on says WHO stopped: a run the operator staged and left
 * becomes `abandoned`; a run that was waiting on us becomes `expired`; a run
 * that already finished keeps the status it finished with, because losing its
 * entries closes its undo window rather than changing its outcome.
 *
 * The pass is idempotent because it clears the due date it matched on — a row
 * with no due date is not due again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EXECUTORS } from '../../../server/lib/compliance/retention-executors';
import type { ExecutorContext } from '../../../server/lib/compliance/retention-executor-context';
import { MIGRATION_BATCH_STATUSES } from '../../../server/lib/status/migration-batch-status';
import { expiryFor } from '../../../server/services/migration-intake/assistance.service';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../../server/lib/compliance/retention-windows';

const DAY = 24 * 60 * 60 * 1000;

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const NOW = new Date('2026-08-18T04:00:00.000Z');

function fakeBucket() {
    const deleted: string[] = [];
    return {
        deleted,
        delete: vi.fn(async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) deleted.push(k);
        }),
    };
}

/**
 * `heldTenantIds` is spelled out rather than defaulted away: an empty set is
 * what "nothing is held" looks like in production, and a context missing the
 * field would exercise a shape the driver never passes.
 */
function ctxWith(bucket: ReturnType<typeof fakeBucket> | null): ExecutorContext {
    return {
        now: NOW.getTime(),
        stores: bucket ? { photos: bucket as unknown as R2Bucket } : {},
        heldTenantIds: new Set<string>(),
    };
}

async function seed(
    db: BetterSQLite3Database<typeof schema>,
    id: string,
    status: 'staged' | 'needs_assistance' | 'applied' | 'partially_applied',
    expiresAt: Date | null,
) {
    await db.insert(schema.migrationBatches).values({
        id,
        tenantId: TENANT,
        createdBy: 'u1',
        intent: 'contacts.import',
        vendor: 'csv_generic',
        adapterName: 'csv-generic',
        adapterVersion: '1',
        manifest: '{"warnings":[]}',
        status,
        createdAt: new Date(NOW.getTime() - 1000),
        expiresAt,
        sourceKey: `${TENANT}/migrations/${id}/source.csv`,
    });
    await db.insert(schema.migrationRows).values({
        id: `${id}-row`,
        batchId: id,
        tenantId: TENANT,
        entity: 'contact',
        position: 0,
        payload: '{"name":"Alice","email":"alice@example.test","type":"client"}',
    });
}

describe('the batch status axis', () => {
    it('names both ways a waiting run can end', () => {
        expect([...MIGRATION_BATCH_STATUSES]).toEqual([
            'staged', 'applying', 'applied', 'partially_applied',
            'reverted', 'partially_reverted', 'abandoned', 'declined',
            'needs_assistance', 'expired',
        ]);
    });

    it('keeps abandoned and declined apart, because the responsible party is not the same', () => {
        // abandoned: the operator stopped. declined: we looked and could not
        // convert it. A column that recorded both as one value would be, on
        // this point, not a status column at all.
        expect(MIGRATION_BATCH_STATUSES).toContain('abandoned');
        expect(MIGRATION_BATCH_STATUSES).toContain('declined');
    });
});

describe('migration_batches executor leaves a record behind', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    afterEach(() => sqlite.close());

    async function sweep(bucket: ReturnType<typeof fakeBucket> | null) {
        return EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket));
    }

    async function batchRow(id: string) {
        return db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, id)).get();
    }

    it('turns an expired staged run into an abandoned one with no entries and no file', async () => {
        await seed(db, 'b-staged', 'staged', new Date(NOW.getTime() - 1000));
        const bucket = fakeBucket();
        expect(await sweep(bucket)).toBe(1);

        expect(bucket.deleted).toEqual([`${TENANT}/migrations/b-staged/source.csv`]);
        const batch = await batchRow('b-staged');
        expect(batch?.status).toBe('abandoned');
        expect(batch?.sourceKey).toBeNull();
        expect(batch?.expiresAt).toBeNull();
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
    });

    it('turns an expired waiting run into an expired one — we stopped, not them', async () => {
        await seed(db, 'b-wait', 'needs_assistance', new Date(NOW.getTime() - 1000));
        expect(await sweep(fakeBucket())).toBe(1);
        expect((await batchRow('b-wait'))?.status).toBe('expired');
    });

    it('keeps a finished run at the status it finished with', async () => {
        await seed(db, 'b-done', 'partially_applied', new Date(NOW.getTime() - 1000));
        expect(await sweep(fakeBucket())).toBe(1);
        // Not `abandoned`: nobody abandoned it. It ran, and now its undo window
        // has closed — which is what losing the entries means.
        expect((await batchRow('b-done'))?.status).toBe('partially_applied');
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
    });

    it('sorts three runs that came due together by where each one stopped', async () => {
        // The three single-status cases above each pass on a blanket UPDATE that
        // wrote the wrong value everywhere but happened to match that one row.
        // Only a pass with all three present can see that they diverge.
        await seed(db, 'b-staged', 'staged', new Date(NOW.getTime() - 1000));
        await seed(db, 'b-wait', 'needs_assistance', new Date(NOW.getTime() - 1000));
        await seed(db, 'b-done', 'applied', new Date(NOW.getTime() - 1000));
        expect(await sweep(fakeBucket())).toBe(3);
        expect((await batchRow('b-staged'))?.status).toBe('abandoned');
        expect((await batchRow('b-wait'))?.status).toBe('expired');
        expect((await batchRow('b-done'))?.status).toBe('applied');
    });

    it('does the same work twice without reporting it twice', async () => {
        await seed(db, 'b-staged', 'staged', new Date(NOW.getTime() - 1000));
        expect(await sweep(fakeBucket())).toBe(1);
        expect(await sweep(fakeBucket())).toBe(0);
    });

    it('leaves a run whose own clock has not run out', async () => {
        await seed(db, 'b-live', 'staged', new Date(NOW.getTime() + 1000));
        const bucket = fakeBucket();
        expect(await sweep(bucket)).toBe(0);
        expect(bucket.deleted).toEqual([]);
        expect(await db.select().from(schema.migrationRows).all()).toHaveLength(1);
    });

    it('refuses rather than half-clearing when a due run has a file and no bucket', async () => {
        await seed(db, 'b-staged', 'staged', new Date(NOW.getTime() - 1000));
        await expect(sweep(null)).rejects.toThrow(/bucket/i);
        const batch = await batchRow('b-staged');
        // Nothing moved. A refusal that had already cleared the key would have
        // left an object nothing knows the name of.
        expect(batch?.status).toBe('staged');
        expect(batch?.sourceKey).toBe(`${TENANT}/migrations/b-staged/source.csv`);
        expect(await db.select().from(schema.migrationRows).all()).toHaveLength(1);
    });
});

/**
 * The date the sweep above matches on, decided when the run is opened.
 *
 * It lives beside that sweep because the two are one mechanism read from
 * opposite ends: this sets the clock, the sweep is what running out means.
 */
describe('expiryFor', () => {
    it('gives a run waiting on a person the longer window', () => {
        expect(expiryFor(true, NOW).getTime())
            .toBe(NOW.getTime() + MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS * DAY);
    });

    it('gives a run the operator staged the shorter one', () => {
        expect(expiryFor(false, NOW).getTime())
            .toBe(NOW.getTime() + MIGRATION_INTAKE_STAGED_RETENTION_DAYS * DAY);
    });

    it('really is two different windows', () => {
        // Positive control for the pair above: they would both pass against a
        // function that ignored its argument if the two constants were equal.
        expect(MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS)
            .not.toBe(MIGRATION_INTAKE_STAGED_RETENTION_DAYS);
        expect(expiryFor(true, NOW).getTime()).toBeGreaterThan(expiryFor(false, NOW).getTime());
    });
});
