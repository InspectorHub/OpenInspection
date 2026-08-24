/**
 * Undoing an applied batch, one row at a time.
 *
 * Each entity kind is undone differently, and a row that cannot be undone does
 * not stop the ones that can: the batch lands on partially_reverted and every
 * refusal is named. Undoing is worth building here rather than labelling the
 * imported data and moving on, because the staging rows already carry the id
 * each row produced — which makes undoing a creation nearly free — and because
 * overwriting a template discards an entire comment library in one press.
 *
 * Two shapes of vacuous pass are guarded against throughout:
 *
 *  - "the row is gone" passes when the row was never created. Every deletion
 *    case therefore proves the row EXISTS after apply and before the undo.
 *  - "the snapshot was restored" passes when the snapshot is empty. Every
 *    restore case asserts the restored CONTENT field by field, and is paired
 *    with a mutated snapshot proving the undo refuses rather than writing junk
 *    over the row it was meant to rescue.
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
    BundleMember,
    BundleTemplate,
    EntityCounts,
    MigrationBundleV1,
} from '../../../server/lib/migration-intake/bundle';
import type { TemplateSchemaV2 } from '../../../server/types/template-schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';
import { MigrationRevertService } from '../../../server/services/migration-intake/revert.service';
import { getSeatUsage } from '../../../server/features/seat-quota/usage';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const TEMPLATE = '33333333-3333-3333-3333-3333333333c3';

const SCHEMA_A: TemplateSchemaV2 = {
    schemaVersion: 2,
    sections: [{ id: 'sec_a', title: 'Roof', items: [] }],
};
const SCHEMA_B: TemplateSchemaV2 = {
    schemaVersion: 2,
    sections: [{ id: 'sec_b', title: 'Attic', items: [] }],
};

const STATS: BundleTemplate['stats'] = {
    sections: 1, items: 0, information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
};

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function filled(n: number): EntityCounts {
    return { readFromSource: n, emitted: n, dropped: [] };
}

function templateBundle(list: { name: string; schema: TemplateSchemaV2 }[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'spectora' },
            adapter: { name: 'spectora', version: '1' },
            counts: { template: filled(list.length), contact: EMPTY, member: EMPTY },
            warnings: [],
        },
        templates: list.map((t) => ({ name: t.name, schema: t.schema, stats: STATS })),
        contacts: [],
        members: [],
    };
}

function contactsBundle(list: BundleContact[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: { template: EMPTY, contact: filled(list.length), member: EMPTY },
            warnings: [],
        },
        templates: [],
        contacts: list,
        members: [],
    };
}

function membersBundle(list: BundleMember[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: { template: EMPTY, contact: EMPTY, member: filled(list.length) },
            warnings: [],
        },
        templates: [],
        contacts: [],
        members: list,
    };
}

/** The stored document, whichever of the two shapes the json-mode column hands back. */
function readSchema(stored: unknown): unknown {
    return typeof stored === 'string' ? JSON.parse(stored) : stored;
}

describe('MigrationRevertService.revert', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;
    let apply: MigrationApplyService;
    let revert: MigrationRevertService;

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
        apply = new MigrationApplyService({} as D1Database);
        revert = new MigrationRevertService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    function seedTemplate(id: string, name: string, doc: TemplateSchemaV2) {
        return db.insert(schema.templates).values({
            id, tenantId: TENANT, name, version: 1,
            schema: JSON.stringify(doc), createdAt: new Date(),
        });
    }

    /**
     * An inspection is what blocks a template delete, and the columns below are
     * the ones the table actually requires — a fixture missing them would fail
     * on the INSERT and be read as the delete guard firing.
     */
    function seedInspection(id: string, templateId: string) {
        return db.insert(schema.inspections).values({
            id, tenantId: TENANT, templateId, propertyAddress: '1 Test St',
            date: '2026-01-01', status: 'scheduled', createdAt: new Date(),
        });
    }

    function seedInspectionPerson(id: string, contactId: string) {
        return db.insert(schema.inspectionPeople).values({
            id, tenantId: TENANT, inspectionId: 'insp-1',
            contactId, roleProfileId: 'rp-1', createdAt: new Date(),
        });
    }

    async function stageTemplates(
        list: { name: string; schema: TemplateSchemaV2 }[],
        intent: 'templates.create' | 'templates.overwrite',
        targetId?: string,
    ) {
        return stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent, targetId, bundle: templateBundle(list),
        });
    }

    async function stageContacts(list: BundleContact[]) {
        return stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'contacts.import', bundle: contactsBundle(list),
        });
    }

    async function stageMembers(list: BundleMember[]) {
        return stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'members.invite', bundle: membersBundle(list),
        });
    }

    function applyBatch(batchId: string, conflictPolicy: 'skip' | 'overwrite' | 'per_row' = 'skip', rowResolutions?: Record<string, 'skip' | 'overwrite'>) {
        return apply.apply({
            tenantId: TENANT, batchId, conflictPolicy, rowResolutions, seatQuotaEnforced: false,
        });
    }

    function rowsOf(batchId: string) {
        return db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
    }

    // ── Template rows ───────────────────────────────────────────────────────

    it('deletes a template this batch created', async () => {
        const staged = await stageTemplates([{ name: 'New', schema: SCHEMA_A }], 'templates.create');
        await applyBatch(staged.batchId);
        // Prove the setup before asserting an absence: "the template is gone"
        // is true of a run that never created one.
        const created = await db.select().from(schema.templates).all();
        expect(created).toHaveLength(1);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });

        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(result.refused).toEqual([]);
        expect(await db.select().from(schema.templates).all()).toEqual([]);

        const [row] = await rowsOf(staged.batchId);
        expect(row.status).toBe('reverted');
        expect(row.outcome).toBeNull();

        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, staged.batchId)).get();
        expect(batch?.status).toBe('reverted');
        expect(batch?.revertedAt).not.toBeNull();
    });

    it('refuses to delete a template an inspection still uses, and names the blocker', async () => {
        const staged = await stageTemplates([{ name: 'New', schema: SCHEMA_A }], 'templates.create');
        await applyBatch(staged.batchId);
        const created = await db.select().from(schema.templates).get();
        expect(created).toBeTruthy();
        await seedInspection('insp-1', created!.id);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });

        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(0);
        expect(result.refused).toHaveLength(1);
        expect(result.refused[0]).toMatchObject({ entity: 'template', position: 0 });
        expect(result.refused[0].reason).toMatch(/inspections/i);

        expect(await db.select().from(schema.templates).all()).toHaveLength(1);
        const [row] = await rowsOf(staged.batchId);
        // It still IS applied — the refusal did not undo it — and the reason
        // lives on the row so the refusal list can be read back from the table
        // rather than only from this return value.
        expect(row.status).toBe('applied');
        expect(row.outcome).toMatch(/inspections/i);
        expect(row.id).toBe(result.refused[0].rowId);
    });

    it('restores the schema an overwrite replaced', async () => {
        await seedTemplate(TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stageTemplates([{ name: 'Replacement', schema: SCHEMA_B }], 'templates.overwrite', TEMPLATE);
        await applyBatch(staged.batchId, 'overwrite');
        // Positive control for the restore below: the overwrite really did
        // replace the document, so "it holds SCHEMA_A" is not simply the state
        // nothing ever left.
        const overwritten = await db.select().from(schema.templates)
            .where(eq(schema.templates.id, TEMPLATE)).get();
        expect(readSchema(overwritten?.schema)).toEqual(SCHEMA_B);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(result.refused).toEqual([]);

        const live = await db.select().from(schema.templates)
            .where(eq(schema.templates.id, TEMPLATE)).get();
        // Asserted by content, section id included. A snapshot that merely
        // exists would restore whatever it happens to hold, and `{}` is a
        // perfectly good non-null value.
        const restored = readSchema(live?.schema) as TemplateSchemaV2;
        expect(restored).toEqual(SCHEMA_A);
        expect(restored.sections.map((s) => s.id)).toEqual(['sec_a']);
        expect(restored).not.toEqual(SCHEMA_B);
        // The overwrite left the name alone, so the undo has no name to put
        // back — and must not invent one from the file that was imported.
        expect(live?.name).toBe('Live');
        // Restoring is an edit, not a rewind of the row's history.
        expect(await db.select().from(schema.templates).all()).toHaveLength(1);
    });

    it('refuses a template overwrite whose snapshot cannot be a template, rather than emptying the row', async () => {
        await seedTemplate(TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stageTemplates([{ name: 'Replacement', schema: SCHEMA_B }], 'templates.overwrite', TEMPLATE);
        await applyBatch(staged.batchId, 'overwrite');
        // The exact failure a non-null check cannot see: a snapshot that is
        // present, parses, and says nothing.
        await db.update(schema.migrationRows).set({ priorState: '{}' })
            .where(eq(schema.migrationRows.batchId, staged.batchId));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(0);
        expect(result.refused).toHaveLength(1);

        const live = await db.select().from(schema.templates)
            .where(eq(schema.templates.id, TEMPLATE)).get();
        // Still the imported document. Refusing leaves the operator with the
        // import they can see; writing `{}` would leave them with nothing.
        expect(readSchema(live?.schema)).toEqual(SCHEMA_B);
    });

    /**
     * Which way a row is undone is decided by whether it REPLACED something,
     * and that is recorded by the apply path at the moment of the write. The
     * settlement column answers a different question and is null for every
     * batch-wide policy, so a revert that branched on it would mistake a
     * batch-wide overwrite for a creation and DELETE the row it was asked to
     * restore. Both policies are exercised here for exactly that reason.
     */
    it('restores an overwrite under a batch-wide policy, which records no per-row settlement', async () => {
        await seedTemplate(TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stageTemplates([{ name: 'Replacement', schema: SCHEMA_B }], 'templates.overwrite', TEMPLATE);
        await applyBatch(staged.batchId, 'overwrite');

        const [before] = await rowsOf(staged.batchId);
        expect(before.resolution).toBeNull();
        expect(before.priorState).not.toBeNull();

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        const live = await db.select().from(schema.templates)
            .where(eq(schema.templates.id, TEMPLATE)).get();
        expect(readSchema(live?.schema)).toEqual(SCHEMA_A);
        // The row is still there. A revert reading the settlement column would
        // have found null here and deleted it.
        expect(await db.select().from(schema.templates).all()).toHaveLength(1);
    });

    it('restores an overwrite the operator settled row by row, the same way', async () => {
        await seedTemplate(TEMPLATE, 'Live', SCHEMA_A);
        const staged = await stageTemplates([{ name: 'Replacement', schema: SCHEMA_B }], 'templates.overwrite', TEMPLATE);
        await applyBatch(staged.batchId, 'per_row', { [staged.rows[0].id]: 'overwrite' });

        const [before] = await rowsOf(staged.batchId);
        expect(before.resolution).toBe('overwrite');

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        const live = await db.select().from(schema.templates)
            .where(eq(schema.templates.id, TEMPLATE)).get();
        expect(readSchema(live?.schema)).toEqual(SCHEMA_A);
    });

    // ── Contact rows ────────────────────────────────────────────────────────

    it('deletes a contact this batch created', async () => {
        const staged = await stageContacts([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId);
        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(result.refused).toEqual([]);
        expect(await db.select().from(schema.contacts).all()).toEqual([]);
    });

    it('refuses to delete a contact an inspection now names', async () => {
        const staged = await stageContacts([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId);
        const created = await db.select().from(schema.contacts).get();
        expect(created).toBeTruthy();
        await seedInspectionPerson('ip-1', created!.id);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(0);
        expect(result.refused).toHaveLength(1);
        expect(result.refused[0]).toMatchObject({ entity: 'contact', position: 0 });
        expect(result.refused[0].reason).toMatch(/inspection/i);
        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);
        const [row] = await rowsOf(staged.batchId);
        expect(row.status).toBe('applied');
        expect(row.outcome).toMatch(/inspection/i);
    });

    it('restores the fields a contact overwrite replaced', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', phone: '555-1', agency: 'Old Co', createdAt: new Date(),
        });
        const staged = await stageContacts([
            { name: 'Alice New', email: 'alice@example.test', phone: '555-9', type: 'agent' },
        ]);
        await applyBatch(staged.batchId, 'overwrite');
        // Positive control: the overwrite really did change all four columns,
        // including clearing the one the file did not carry.
        const after = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-1')).get();
        expect(after).toMatchObject({ name: 'Alice New', phone: '555-9', type: 'agent' });
        expect(after?.agency).toBeNull();

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(result.refused).toEqual([]);

        const live = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-1')).get();
        // Field by field, the cleared one included: a snapshot missing `agency`
        // would silently fail to bring it back, and a non-null check on the
        // snapshot would not notice.
        expect(live).toMatchObject({
            name: 'Alice Old', phone: '555-1', agency: 'Old Co', type: 'client',
        });
        // The address is what matched this row in the first place, so the
        // overwrite never touched it and the undo has nothing to put back.
        expect(live?.email).toBe('alice@example.test');
        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);
    });

    it('restores the note an overwrite replaced', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-notes', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', notes: 'Gate code 4021.', createdAt: new Date(),
        });
        const staged = await stageContacts([
            { name: 'Alice New', email: 'alice@example.test', notes: 'Call ahead.', type: 'client' },
        ]);
        await applyBatch(staged.batchId, 'overwrite');
        // Positive control: the overwrite really did replace the note. Without
        // it, "the old note is back" also passes on a write that never
        // happened.
        const after = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-notes')).get();
        expect(after?.notes).toBe('Call ahead.');

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });

        const live = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-notes')).get();
        expect(live?.notes).toBe('Gate code 4021.');
    });

    it('refuses a contact overwrite whose snapshot lost a field, rather than half-restoring the row', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', phone: '555-1', agency: 'Old Co', createdAt: new Date(),
        });
        const staged = await stageContacts([
            { name: 'Alice New', email: 'alice@example.test', phone: '555-9', type: 'agent' },
        ]);
        await applyBatch(staged.batchId, 'overwrite');
        // Everything a non-null check asks for, and one column short of an undo.
        await db.update(schema.migrationRows)
            .set({ priorState: JSON.stringify({ name: 'Alice Old', email: 'alice@example.test', phone: '555-1', type: 'client' }) })
            .where(eq(schema.migrationRows.batchId, staged.batchId));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(0);
        expect(result.refused).toHaveLength(1);

        // Untouched: a half-restore would have put the name and phone back and
        // left the type and agency as the import made them, producing a row no
        // source can account for.
        const live = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-1')).get();
        expect(live).toMatchObject({ name: 'Alice New', phone: '555-9', type: 'agent' });
        expect(live?.agency).toBeNull();
    });

    it('refuses to restore a contact that has since been deleted', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const staged = await stageContacts([{ name: 'Alice New', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId, 'overwrite');
        await db.delete(schema.contacts).where(eq(schema.contacts.id, 'existing-1'));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        // An UPDATE that matches nothing succeeds and changes nothing, so a
        // restore that did not look first would report this row as put back.
        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(0);
        expect(result.refused[0].reason).toMatch(/no longer/i);
    });

    it('does not reach into another tenant to satisfy a restore', async () => {
        await db.insert(schema.tenants).values({
            id: 'other-tenant', slug: 'b', status: 'active', deploymentMode: 'shared',
            tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const staged = await stageContacts([{ name: 'Alice New', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId, 'overwrite');
        // Move the row out of the tenant between apply and undo. The id still
        // resolves; the tenant filter is the only thing standing between this
        // undo and somebody else's data.
        await db.update(schema.contacts).set({ tenantId: 'other-tenant' })
            .where(eq(schema.contacts.id, 'existing-1'));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result.status).toBe('partially_reverted');
        const theirs = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-1')).get();
        expect(theirs?.name).toBe('Alice New');
    });

    // ── Member rows ─────────────────────────────────────────────────────────

    it('cancels an invite and releases its seat immediately', async () => {
        const staged = await stageMembers([{ email: 'one@example.test', role: 'inspector' }]);
        await applyBatch(staged.batchId);
        expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(1);
        // Held BEFORE the undo — otherwise "zero seats used" is just the state
        // an empty workspace was already in.
        expect((await getSeatUsage(TENANT, {} as D1Database)).used).toBe(1);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(await db.select().from(schema.tenantInvites).all()).toEqual([]);
        // The seat comes back with the row, because usage counts outstanding
        // invitations rather than accepted ones.
        expect((await getSeatUsage(TENANT, {} as D1Database)).used).toBe(0);
    });

    it('cannot cancel an invite somebody already accepted, and says where to go instead', async () => {
        const staged = await stageMembers([{ email: 'one@example.test', role: 'inspector' }]);
        await applyBatch(staged.batchId);
        const invite = await db.select().from(schema.tenantInvites).get();
        expect(invite).toBeTruthy();
        await db.update(schema.tenantInvites).set({ status: 'accepted' })
            .where(eq(schema.tenantInvites.id, invite!.id));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(0);
        expect(result.refused).toHaveLength(1);
        expect(result.refused[0].reason).toMatch(/already joined/i);
        expect(result.refused[0].reason).toMatch(/Team/);
        // Accepted invitations are history: the undo must not delete the record
        // of how somebody got in.
        const survivor = await db.select().from(schema.tenantInvites).get();
        expect(survivor?.status).toBe('accepted');
    });

    it('treats an invitation somebody has already cancelled as nothing left to take back', async () => {
        const staged = await stageMembers([{ email: 'one@example.test', role: 'inspector' }]);
        await applyBatch(staged.batchId);
        const invite = await db.select().from(schema.tenantInvites).get();
        await db.delete(schema.tenantInvites).where(eq(schema.tenantInvites.id, invite!.id));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        // Reporting this as a refusal would send the operator looking for an
        // invitation that is not there. An acceptance keeps its row, so a
        // missing row can only mean somebody cancelled it.
        expect(result).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(result.refused).toEqual([]);
    });

    it('does not cancel an invitation belonging to another tenant', async () => {
        await db.insert(schema.tenants).values({
            id: 'other-tenant', slug: 'b', status: 'active', deploymentMode: 'shared',
            tier: 'free', createdAt: new Date(),
        });
        const staged = await stageMembers([{ email: 'one@example.test', role: 'inspector' }]);
        await applyBatch(staged.batchId);
        const invite = await db.select().from(schema.tenantInvites).get();
        await db.update(schema.tenantInvites).set({ tenantId: 'other-tenant' })
            .where(eq(schema.tenantInvites.id, invite!.id));

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(1);
        // Positive control that the tenant filter — not some other refusal — is
        // what spared the row: the same undo cancels it when it is ours.
        expect(result.reverted + result.refused.length).toBe(1);
    });

    // ── Whole-batch behaviour ───────────────────────────────────────────────

    it('undoes the rows it can even when one refuses', async () => {
        const staged = await stageContacts([
            { name: 'Keeper', email: 'keeper@example.test', type: 'client' },
            { name: 'Goner', email: 'goner@example.test', type: 'client' },
        ]);
        await applyBatch(staged.batchId);
        expect(await db.select().from(schema.contacts).all()).toHaveLength(2);
        const keeper = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.email, 'keeper@example.test')).get();
        await seedInspectionPerson('ip-1', keeper!.id);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result.status).toBe('partially_reverted');
        expect(result.reverted).toBe(1);
        expect(result.refused).toHaveLength(1);
        const remaining = await db.select().from(schema.contacts).all();
        expect(remaining.map((c) => c.email)).toEqual(['keeper@example.test']);

        const rows = await rowsOf(staged.batchId);
        expect(rows.find((r) => r.position === 0)?.status).toBe('applied');
        expect(rows.find((r) => r.position === 1)?.status).toBe('reverted');
        // Positive control for the outcome column: the row that WAS undone
        // carries no reason, so "every row has a reason" cannot pass either.
        expect(rows.find((r) => r.position === 1)?.outcome).toBeNull();
    });

    it('leaves a skipped row alone — there is nothing of its to undo', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const staged = await stageContacts([{ name: 'Alice New', email: 'alice@example.test', type: 'client' }]);
        const applied = await applyBatch(staged.batchId, 'skip');
        expect(applied.skipped).toBe(1);

        const result = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(result).toMatchObject({ status: 'reverted', reverted: 0 });
        expect(result.refused).toEqual([]);
        const live = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, 'existing-1')).get();
        expect(live?.name).toBe('Alice Old');
        // The row keeps saying what happened to it. Rewriting a skip as a
        // revert would claim the undo did something it did not do.
        const [row] = await rowsOf(staged.batchId);
        expect(row.status).toBe('skipped');
    });

    it('picks up the rows a partly refused undo left behind', async () => {
        const staged = await stageContacts([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId);
        const created = await db.select().from(schema.contacts).get();
        await seedInspectionPerson('ip-1', created!.id);

        const first = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(first.status).toBe('partially_reverted');

        // The blocker goes away, and the operator presses undo again.
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.id, 'ip-1'));
        const second = await revert.revert({ tenantId: TENANT, batchId: staged.batchId });
        expect(second).toMatchObject({ status: 'reverted', reverted: 1 });
        expect(await db.select().from(schema.contacts).all()).toEqual([]);
        const [row] = await rowsOf(staged.batchId);
        expect(row.status).toBe('reverted');
        // The refusal it used to carry is cleared, so the row does not go on
        // explaining a state it is no longer in.
        expect(row.outcome).toBeNull();
    });

    it('refuses to undo a batch that was never applied', async () => {
        const staged = await stageContacts([{ name: 'Alice', type: 'client' }]);
        await expect(revert.revert({ tenantId: TENANT, batchId: staged.batchId }))
            .rejects.toThrow(/has not been applied/i);
        const [row] = await rowsOf(staged.batchId);
        expect(row.status).toBe('pending');
    });

    it('says an already-undone batch has already been undone', async () => {
        const staged = await stageContacts([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId);
        await revert.revert({ tenantId: TENANT, batchId: staged.batchId });

        await expect(revert.revert({ tenantId: TENANT, batchId: staged.batchId }))
            .rejects.toThrow(/already been undone/i);
    });

    it('refuses a batch belonging to another tenant, and writes nothing', async () => {
        const staged = await stageContacts([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]);
        await applyBatch(staged.batchId);

        await expect(revert.revert({ tenantId: 'someone-else', batchId: staged.batchId }))
            .rejects.toThrow(/not found/i);

        expect(await db.select().from(schema.contacts).all()).toHaveLength(1);
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, staged.batchId)).get();
        expect(batch?.status).toBe('applied');
        expect(batch?.revertedAt).toBeNull();
    });
});
