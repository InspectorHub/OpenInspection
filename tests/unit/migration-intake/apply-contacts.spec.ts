/**
 * Applying contact rows.
 *
 * A clash is settled by the policy the operator chose, and an overwrite keeps
 * what it replaced — asserted field by field, because a snapshot that is merely
 * present cannot restore anything. A contact WITHOUT an email is never matched
 * against anything: two people who share a name are not the same person, and a
 * wrong merge cannot be undone while a duplicate can be merged later.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function contactsBundle(list: BundleContact[]): MigrationBundleV1 {
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
        contacts: list,
        members: [],
    };
}

describe('MigrationApplyService — contact rows', () => {
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

    it('inserts a fresh contact and records the minted id', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice', email: 'alice@example.test', agency: 'Acme', type: 'agent' },
            ]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'applied', applied: 1, skipped: 0, failed: 0 });

        const created = await db.select().from(schema.contacts).all();
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            name: 'Alice', email: 'alice@example.test', agency: 'Acme', type: 'agent', tenantId: TENANT,
        });
        expect(created[0].phone).toBeNull();

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        expect(row?.status).toBe('applied');
        expect(row?.createdId).toBe(created[0].id);
        // Nothing was replaced. The overwrite case below is the positive
        // control for this column.
        expect(row?.priorState).toBeNull();
    });

    it('skips a clashing contact under the skip policy and says so', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', phone: '555-1', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice New', email: 'alice@example.test', type: 'client' }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ applied: 0, skipped: 1, failed: 0, status: 'applied' });

        const live = await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'existing-1')).get();
        expect(live?.name).toBe('Alice Old');
        expect(live?.phone).toBe('555-1');
        // A skip is not a create either: nothing new was added alongside it.
        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        expect(row?.status).toBe('skipped');
        expect(row?.outcome).toMatch(/already/i);
        expect(row?.createdId).toBeNull();
    });

    it('overwrites a clashing contact and keeps every field it replaced', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', phone: '555-1', agency: 'Old Co', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice New', email: 'alice@example.test', phone: '555-9', type: 'agent' },
            ]),
        });
        await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });

        const live = await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'existing-1')).get();
        expect(live).toMatchObject({ name: 'Alice New', phone: '555-9', type: 'agent' });
        // A field the import did not carry is cleared rather than left behind:
        // the row now says what the file said, not a blend of two sources.
        expect(live?.agency).toBeNull();
        // The address is what matched this row in the first place. Rewriting it
        // would turn the row into a different person.
        expect(live?.email).toBe('alice@example.test');
        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        // Asserted field by field. A revert reads this and nothing else, so a
        // snapshot missing `agency` would silently fail to restore it — and a
        // non-null check would not notice.
        expect(JSON.parse(row?.priorState as string)).toEqual({
            name: 'Alice Old', email: 'alice@example.test', phone: '555-1', agency: 'Old Co', type: 'client',
        });
        expect(row?.createdId).toBe('existing-1');
        expect(row?.status).toBe('applied');
    });

    it('settles each row on its own answer under the per_row policy', async () => {
        await db.insert(schema.contacts).values([
            { id: 'e1', tenantId: TENANT, type: 'client', name: 'One Old', email: 'one@example.test', createdAt: new Date() },
            { id: 'e2', tenantId: TENANT, type: 'client', name: 'Two Old', email: 'two@example.test', createdAt: new Date() },
        ]);
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'One New', email: 'one@example.test', type: 'client' },
                { name: 'Two New', email: 'two@example.test', type: 'client' },
            ]),
        });
        const rowFor = (pos: number) => staged.rows.find((r) => r.position === pos)!.id;

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'per_row', seatQuotaEnforced: false,
            rowResolutions: { [rowFor(0)]: 'overwrite', [rowFor(1)]: 'skip' },
        });
        expect(result).toMatchObject({ applied: 1, skipped: 1, failed: 0 });
        expect((await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'e1')).get())?.name).toBe('One New');
        expect((await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'e2')).get())?.name).toBe('Two Old');

        // Each row records the answer it was settled on, so a report can say
        // which entry the operator chose to replace rather than inferring it.
        const overwritten = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, rowFor(0))).get();
        const kept = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, rowFor(1))).get();
        expect(overwritten?.resolution).toBe('overwrite');
        expect(kept?.resolution).toBe('skip');
    });

    it('inserts an email-less contact even when a same-named one exists', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice', email: null, createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice', type: 'client' }]),
        });
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ applied: 1, skipped: 0 });
        expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
    });

    it('fails the row rather than the run when the clashing contact has gone', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice New', email: 'alice@example.test', type: 'client' },
                { name: 'Bob', email: 'bob@example.test', type: 'client' },
            ]),
        });
        // The clash is settled between staging and applying — the window the
        // snapshot is captured at apply time to survive.
        await db.delete(schema.contacts).where(eq(schema.contacts.id, 'existing-1'));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        expect(result).toMatchObject({ status: 'partially_applied', applied: 1, failed: 1 });

        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
        const failed = rows.find((r) => r.position === 0);
        expect(failed?.status).toBe('failed');
        expect(failed?.outcome).toMatch(/no longer exists/i);
        expect(failed?.createdId).toBeNull();
        // Positive control: the row after it still got its turn.
        expect(rows.find((r) => r.position === 1)?.status).toBe('applied');
        expect((await db.select().from(schema.contacts).all()).map((c) => c.name)).toEqual(['Bob']);
    });

    it('does not reach into another tenant to satisfy an overwrite', async () => {
        await db.insert(schema.tenants).values({
            id: 'other-tenant', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.contacts).values({
            id: 'theirs-1', tenantId: 'other-tenant', type: 'client', name: 'Theirs',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice New', email: 'alice@example.test', type: 'client' }]),
        });
        // Staging saw no clash across the tenant boundary, so this is a create.
        expect(staged.rows[0].conflictWith).toBeNull();

        await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: false,
        });
        const theirs = await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'theirs-1')).get();
        expect(theirs?.name).toBe('Theirs');
        expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
    });
});
