/**
 * An intake run holds third-party personal data — the operator's clients' names,
 * email addresses and phone numbers — in a staging row and in an object nothing
 * else points at. So it expires, and the expiry is enforced rather than
 * declared.
 *
 * Two lifetimes, one rule. A run the operator staged and left goes after thirty
 * days; a run waiting on a person goes after ninety. The catalogue states the
 * outer bound because a table gets one rule; the per-batch column is what the
 * sweep compares, and the executor reads it.
 *
 * Object first, entries second, key last. The batch row is the only thing that
 * knows the object's key, so clearing the key first leaves an object nothing
 * can ever reach.
 *
 * The batch row itself SURVIVES — it carries no third-party data, only ids,
 * timestamps, a vendor name and this workspace's own authorisations. Which
 * status a cleared run lands on, and why the answer differs per run, lives in
 * `tests/unit/migration-intake/batch-terminal-states.spec.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EXECUTORS } from '../../../server/lib/compliance/retention-executors';
import type { ExecutorContext } from '../../../server/lib/compliance/retention-executor-context';
import { RETENTION_MANIFEST, RETENTION_OUT_OF_SCOPE } from '../../../server/lib/compliance/retention-manifest';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_REMINDER_LEAD_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../../server/lib/compliance/retention-windows';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
/** A second workspace, so "the sweep deleted it" can be told from "the sweep deleted everything". */
const OTHER = '11111111-1111-1111-1111-1111111111b2';
const NOW = new Date('2026-08-18T04:00:00.000Z');

function fakeBucket() {
    const deleted: string[] = [];
    const del = vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) deleted.push(k);
    });
    return { deleted, delete: del };
}

/**
 * The context the driver hands an executor. `heldTenantIds` is not optional and
 * must not be defaulted away here: an empty set is what "nothing is held" looks
 * like, and a test that omitted it would be exercising a shape production never
 * passes.
 */
function ctxWith(
    bucket: ReturnType<typeof fakeBucket> | null,
    heldTenantIds: ReadonlySet<string> = new Set(),
): ExecutorContext {
    return {
        now: NOW.getTime(),
        stores: bucket ? { photos: bucket as unknown as R2Bucket } : {},
        heldTenantIds,
    };
}

async function seedBatch(
    db: BetterSQLite3Database<typeof schema>,
    id: string,
    expiresAt: Date | null,
    sourceKey: string | null,
    tenantId: string = TENANT,
) {
    await db.insert(schema.migrationBatches).values({
        id,
        tenantId,
        createdBy: 'u1',
        intent: 'contacts.import',
        vendor: 'csv_generic',
        adapterName: 'csv-generic',
        adapterVersion: '1',
        manifest: '{"warnings":[]}',
        createdAt: new Date(NOW.getTime() - 1000),
        expiresAt,
        sourceKey,
    });
    await db.insert(schema.migrationRows).values({
        id: `${id}-row`,
        batchId: id,
        tenantId,
        entity: 'contact',
        position: 0,
        payload: '{"name":"Alice","email":"alice@example.test","type":"client"}',
    });
}

describe('migration intake retention', () => {
    it('declares the two windows separately', () => {
        expect(MIGRATION_INTAKE_STAGED_RETENTION_DAYS).toBe(30);
        expect(MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS).toBe(90);
    });

    it('warns before the shorter of the two lifetimes, not after it', () => {
        // A reminder lead longer than the window it warns about would fire on
        // the day the batch was created, or never.
        expect(MIGRATION_INTAKE_REMINDER_LEAD_DAYS).toBeGreaterThan(0);
        expect(MIGRATION_INTAKE_REMINDER_LEAD_DAYS).toBeLessThan(MIGRATION_INTAKE_STAGED_RETENTION_DAYS);
    });

    it('states the OUTER bound in the catalogue and names the per-row clock', () => {
        const rule = RETENTION_MANIFEST.find((r) => r.table === 'migration_batches');
        expect(rule).toBeDefined();
        expect(rule?.action).toBe('erase_in_place');
        expect(rule?.window).toEqual({ unit: 'days', value: MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS });
        expect(rule?.rowWindowColumn).toBe('expires_at');
        expect(rule?.purpose.length).toBeGreaterThan(40);
    });

    it('classifies the rule as tenant_scoped, because the table carries a tenant', () => {
        // Not decoration: `suspend_all` or `not_applicable` on a table that HAS
        // a tenant column means a preservation order is either over-applied or
        // not applied at all. The behavioural proof is in legal-hold-sweep.spec.
        const rule = RETENTION_MANIFEST.find((r) => r.table === 'migration_batches');
        expect(rule?.legalHold).toBe('tenant_scoped');
        expect(rule?.legalHoldNote).toBeUndefined();
    });

    it('records the staging rows as governed by the batch rather than ungoverned', () => {
        const entry = RETENTION_OUT_OF_SCOPE.find((e) => e.table === 'migration_rows');
        expect(entry).toBeDefined();
        expect(entry?.reason).toMatch(/migration_batches/);
    });

    it('declares migration_batches exactly once across the three arrays', () => {
        const inManifest = RETENTION_MANIFEST.filter((r) => r.table === 'migration_batches').length;
        const inOutOfScope = RETENTION_OUT_OF_SCOPE.filter((e) => e.table === 'migration_batches').length;
        expect(inManifest + inOutOfScope).toBe(1);
    });
});

describe('migration_batches executor', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values([
            {
                id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            },
            {
                id: OTHER, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            },
        ]);
    });

    afterEach(() => sqlite.close());

    it('clears an expired batch down to its record, and takes its object with it', async () => {
        await seedBatch(db, 'b-old', new Date(NOW.getTime() - 1000), `${TENANT}/migrations/b-old/source.csv`);
        const bucket = fakeBucket();
        const affected = await EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket));
        expect(affected).toBe(1);
        expect(bucket.deleted).toEqual([`${TENANT}/migrations/b-old/source.csv`]);
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
        // The run is still listable, and still says what it was. Which status
        // it lands on, and why, is `batch-terminal-states.spec.ts`.
        expect(await db.select().from(schema.migrationBatches).all()).toHaveLength(1);
    });

    it('leaves a batch whose own clock has not run out', async () => {
        await seedBatch(db, 'b-live', new Date(NOW.getTime() + 1000), `${TENANT}/migrations/b-live/source.csv`);
        const bucket = fakeBucket();
        const affected = await EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket));
        expect(affected).toBe(0);
        expect(bucket.deleted).toEqual([]);
        expect(await db.select().from(schema.migrationRows).all()).toHaveLength(1);
    });

    it('leaves a batch with no due date at all — that is an unfinished write, not an aged one', async () => {
        // The rule's window is 90 days and this batch was created before `now`.
        // A sweep that fell back to the catalogue window when the column is
        // NULL would take it, which is the failure this asserts against.
        await seedBatch(db, 'b-null', null, `${TENANT}/migrations/b-null/source.csv`);
        const bucket = fakeBucket();
        const affected = await EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket));
        expect(affected).toBe(0);
        expect(bucket.deleted).toEqual([]);
        expect(await db.select().from(schema.migrationBatches).all()).toHaveLength(1);
    });

    it('takes only the due batch when a live one sits beside it', async () => {
        // The positive/negative control in ONE pass. Two rows, one due: a
        // predicate that matched everything and one that matched nothing both
        // pass a single-row test, and neither passes this one.
        //
        // Both batch rows survive now, so "which one was swept" is read off the
        // key and the clock rather than off the row's existence — the entries
        // and the object are what actually went.
        await seedBatch(db, 'b-old', new Date(NOW.getTime() - 1000), `${TENANT}/migrations/b-old/source.csv`);
        await seedBatch(db, 'b-live', new Date(NOW.getTime() + 1000), `${TENANT}/migrations/b-live/source.csv`);
        const bucket = fakeBucket();
        const affected = await EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket));
        expect(affected).toBe(1);
        expect(bucket.deleted).toEqual([`${TENANT}/migrations/b-old/source.csv`]);
        const stillHoldingAFile = (await db.select().from(schema.migrationBatches).all())
            .filter((b) => b.sourceKey !== null);
        expect(stillHoldingAFile.map((b) => b.id)).toEqual(['b-live']);
        const rowsLeft = await db.select().from(schema.migrationRows).all();
        expect(rowsLeft.map((r) => r.batchId)).toEqual(['b-live']);
    });

    it('clears a batch with no stored object without asking for the bucket', async () => {
        await seedBatch(db, 'b-nofile', new Date(NOW.getTime() - 1000), null);
        const bucket = fakeBucket();
        const affected = await EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket));
        expect(affected).toBe(1);
        expect(bucket.delete).not.toHaveBeenCalled();
    });

    it('refuses rather than half-deleting when a due batch has an object and no bucket', async () => {
        await seedBatch(db, 'b-old', new Date(NOW.getTime() - 1000), `${TENANT}/migrations/b-old/source.csv`);
        await expect(EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(null)))
            .rejects.toThrow(/bucket/i);
        // Nothing moved. A refusal that had already cleared the key would have
        // left an object nothing knows the name of — and asserting on the batch
        // row alone no longer shows that, because it survives a successful pass
        // too.
        expect(await db.select().from(schema.migrationRows).all()).toHaveLength(1);
        const batch = await db.select().from(schema.migrationBatches).all();
        expect(batch[0]?.sourceKey).toBe(`${TENANT}/migrations/b-old/source.csv`);
    });

    it('leaves every row intact when the object delete itself fails', async () => {
        // THE ordering assertion, and the only one that can see the ordering.
        // "Refuses when there is no bucket" does not: move the delete below the
        // row deletes and that test still passes, because the refusal is a
        // separate guard that runs first either way (verified by mutation).
        // What distinguishes the two orders is a bucket that EXISTS and fails:
        // objects-first leaves the rows, rows-first has already destroyed the
        // only record of the key.
        await seedBatch(db, 'b-old', new Date(NOW.getTime() - 1000), `${TENANT}/migrations/b-old/source.csv`);
        const bucket = {
            deleted: [] as string[],
            delete: vi.fn(async () => { throw new Error('R2 unavailable'); }),
        };
        await expect(EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(bucket)))
            .rejects.toThrow(/R2 unavailable/);
        expect(await db.select().from(schema.migrationBatches).all()).toHaveLength(1);
        expect(await db.select().from(schema.migrationRows).all()).toHaveLength(1);
    });

    it('does not refuse a sweep that has nothing of its own to do', async () => {
        await seedBatch(db, 'b-live', new Date(NOW.getTime() + 1000), `${TENANT}/migrations/b-live/source.csv`);
        const affected = await EXECUTORS.migration_batches(asAnyDb(db), new Date(NOW), ctxWith(null));
        expect(affected).toBe(0);
    });

    it('a held tenant keeps its rows AND its object; an unheld one loses both', async () => {
        // The object half is the reason this case is here rather than only in
        // legal-hold-sweep.spec, which counts rows. An executor that filtered
        // the DELETE but built the key list from the unfiltered query would
        // preserve the held row and destroy the file it points at — a
        // preservation order honoured in D1 and broken in R2.
        await seedBatch(db, 'b-held', new Date(NOW.getTime() - 1000), `${TENANT}/migrations/b-held/source.csv`);
        await seedBatch(db, 'b-free', new Date(NOW.getTime() - 1000), `${OTHER}/migrations/b-free/source.csv`, OTHER);
        const bucket = fakeBucket();

        const affected = await EXECUTORS.migration_batches(
            asAnyDb(db), new Date(NOW), ctxWith(bucket, new Set([TENANT])),
        );

        expect(affected).toBe(1);
        expect(bucket.deleted).toEqual([`${OTHER}/migrations/b-free/source.csv`]);
        // Both rows survive a sweep now, so the held one is identified by what
        // it still HOLDS: the key to its file and its own due date.
        const stillHoldingAFile = (await db.select().from(schema.migrationBatches).all())
            .filter((b) => b.sourceKey !== null);
        expect(stillHoldingAFile.map((b) => b.id)).toEqual(['b-held']);
        const rowsLeft = await db.select().from(schema.migrationRows).all();
        expect(rowsLeft.map((r) => r.batchId)).toEqual(['b-held']);
    });
});
