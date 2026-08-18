/**
 * Staging — what gets written, what gets refused, and what counts as a clash.
 *
 * Nothing here touches a real table. That is the property the whole design
 * rests on: staging can be run repeatedly, each run is a fresh batch, and a
 * refusal costs the operator nothing but a second attempt.
 *
 * Every "this is not a clash" case below is paired with a "this one is",
 * because a conflict finder that returns null for everything satisfies the
 * negative half of this file on its own.
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
    BundleManifest,
    BundleMember,
    BundleTemplate,
    EntityCounts,
    EntityKind,
    MigrationBundleV1,
    VendorId,
} from '../../../server/lib/migration-intake/bundle';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const TEMPLATE = '33333333-3333-3333-3333-3333333333c3';

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

/**
 * Fixtures are typed against the real format rather than assembled as loose
 * object literals: a change to `MigrationBundleV1` should break this file at
 * compile time instead of arriving as a validation failure that reads like a
 * bug in the code under test.
 */
function manifestFor(over: {
    counts?: Partial<Record<EntityKind, EntityCounts>>;
    warnings?: BundleManifest['warnings'];
    vendor?: VendorId;
} = {}): BundleManifest {
    return {
        source: { vendor: over.vendor ?? 'csv_generic' },
        adapter: { name: 'csv-generic', version: '1' },
        counts: { template: EMPTY, contact: EMPTY, member: EMPTY, ...over.counts },
        warnings: over.warnings ?? [],
    };
}

function emitted(n: number): EntityCounts {
    return { readFromSource: n, emitted: n, dropped: [] };
}

function bundleFor(over: Partial<MigrationBundleV1> = {}): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: manifestFor(),
        templates: [],
        contacts: [],
        members: [],
        ...over,
    };
}

function contactsBundle(list: BundleContact[]): MigrationBundleV1 {
    return bundleFor({
        manifest: manifestFor({ counts: { contact: emitted(list.length) } }),
        contacts: list,
    });
}

function membersBundle(list: BundleMember[]): MigrationBundleV1 {
    return bundleFor({
        manifest: manifestFor({ counts: { member: emitted(list.length) } }),
        members: list,
    });
}

function template(name: string): BundleTemplate {
    return {
        name,
        schema: { schemaVersion: 2, sections: [] },
        stats: { sections: 0, items: 0, information: 0, limitations: 0, defects: 0, unknownCommentTypes: [] },
    };
}

function templatesBundle(list: BundleTemplate[]): MigrationBundleV1 {
    return bundleFor({
        manifest: manifestFor({ counts: { template: emitted(list.length) }, vendor: 'spectora' }),
        templates: list,
    });
}

describe('MigrationStageService.stage', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let svc: MigrationStageService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The service batches its two writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        svc = new MigrationStageService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('writes one batch and one row per entry, all pending', async () => {
        const result = await svc.stage({
            tenantId: TENANT,
            createdBy: USER,
            intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice', email: 'alice@example.test', type: 'client' },
                { name: 'Bob', type: 'agent' },
            ]),
        });

        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, result.batchId)).get();
        expect(batch?.status).toBe('staged');
        expect(batch?.conflictPolicy).toBeNull();
        expect(batch?.vendor).toBe('csv_generic');
        expect(batch?.adapterName).toBe('csv-generic');
        expect(batch?.createdBy).toBe(USER);
        expect(batch?.targetId).toBeNull();

        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, result.batchId)).all();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.status === 'pending')).toBe(true);
        expect(rows.every((r) => r.entity === 'contact')).toBe(true);
        expect(rows.every((r) => r.resolution === null)).toBe(true);
        expect(rows.map((r) => r.position).sort()).toEqual([0, 1]);
        expect(result.rows).toHaveLength(2);
    });

    it('stores each entry as its own payload, so a report can name the entry', async () => {
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice', email: 'alice@example.test', type: 'client' },
                { name: 'Bob', type: 'agent' },
            ]),
        });
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, result.batchId)).all();
        const byPosition = new Map(rows.map((r) => [r.position, JSON.parse(r.payload) as BundleContact]));
        expect(byPosition.get(0)).toEqual({ name: 'Alice', email: 'alice@example.test', type: 'client' });
        expect(byPosition.get(1)).toEqual({ name: 'Bob', type: 'agent' });
    });

    it('records the manifest as the producing run wrote it', async () => {
        const bundle = bundleFor({
            manifest: manifestFor({
                counts: { contact: { readFromSource: 2, emitted: 1, dropped: [{ at: 'line 3', reason: 'no name' }] } },
                warnings: [{ code: 'UNMAPPED_COLUMN', message: 'The column "Notes" was not mapped.' }],
            }),
            contacts: [{ name: 'Alice', type: 'client' }],
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', bundle,
        });
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, result.batchId)).get();
        expect(JSON.parse(batch?.manifest ?? 'null')).toEqual(bundle.manifest);
    });

    it('writes no row into any real table', async () => {
        await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]),
        });
        expect(await db.select().from(schema.contacts).all()).toEqual([]);
        expect(await db.select().from(schema.tenantInvites).all()).toEqual([]);
        expect(await db.select().from(schema.templates).all()).toEqual([]);
    });

    it('writes every row of an entry list longer than one bind-limited statement', async () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            name: `Person ${i}`, email: `p${i}@example.test`, type: 'client' as const,
        }));
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', bundle: contactsBundle(many),
        });
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, result.batchId)).all();
        expect(rows).toHaveLength(40);
        expect(new Set(rows.map((r) => r.position)).size).toBe(40);
    });

    it('flags an existing active contact email as the clash it is, whatever its case', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'ALICE@example.test', createdAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([
                { name: 'Alice New', email: 'alice@example.test', type: 'client' },
                { name: 'Bob', email: 'bob@example.test', type: 'client' },
            ]),
        });
        expect(result.rows[0].conflictWith).toBe('existing-1');
        expect(result.rows[1].conflictWith).toBeNull();

        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, result.batchId)).all();
        expect(rows.find((r) => r.position === 0)?.conflictWith).toBe('existing-1');
    });

    it('does not dedupe a contact that has no email', async () => {
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice', email: null, createdAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice', type: 'client' }]),
        });
        expect(result.rows[0].conflictWith).toBeNull();
    });

    it('does not treat an archived contact as a clash — the active unique index does not either', async () => {
        await db.insert(schema.contacts).values({
            id: 'archived-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'alice@example.test', createdAt: new Date(), archivedAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice New', email: 'alice@example.test', type: 'client' }]),
        });
        expect(result.rows[0].conflictWith).toBeNull();
    });

    it('does not reach into another tenant for a contact clash', async () => {
        await db.insert(schema.tenants).values({
            id: 'other-tenant', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.contacts).values({
            id: 'theirs-1', tenantId: 'other-tenant', type: 'client', name: 'Alice',
            email: 'alice@example.test', createdAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice', email: 'alice@example.test', type: 'client' }]),
        });
        expect(result.rows[0].conflictWith).toBeNull();
    });

    it('treats an active member with that address as an existing member', async () => {
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: 'live@example.test', passwordHash: 'x',
            role: 'inspector', createdAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite',
            bundle: membersBundle([
                { email: 'live@example.test', role: 'inspector' },
                { email: 'nobody@example.test', role: 'inspector' },
            ]),
        });
        expect(result.rows[0].conflictWith).toBe('u1');
        expect(result.rows[1].conflictWith).toBeNull();
    });

    it('does not treat a removed member as an existing member', async () => {
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: 'gone@example.test', passwordHash: 'x',
            role: 'inspector', createdAt: new Date(), deletedAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite',
            bundle: membersBundle([{ email: 'gone@example.test', role: 'inspector' }]),
        });
        expect(result.rows[0].conflictWith).toBeNull();
    });

    it('treats an outstanding invite as an existing member', async () => {
        await db.insert(schema.tenantInvites).values({
            id: 'invite-1', tenantId: TENANT, email: 'new@example.test',
            role: 'inspector', status: 'pending', expiresAt: new Date(Date.now() + 1e9),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite',
            bundle: membersBundle([{ email: 'new@example.test', role: 'inspector' }]),
        });
        expect(result.rows[0].conflictWith).toBe('invite-1');
    });

    /**
     * An EXPIRED invite is still an invite row, and `uq_tenant_invites_pending_email`
     * is predicated on `status = 'pending'` alone — it says nothing about expiry.
     * So a second invite to that address cannot be written at all, whatever the
     * expiry date says, and calling it "no clash" here would hand apply a row
     * whose only possible outcome is a unique-constraint failure.
     */
    it('treats an expired pending invite as an existing member too', async () => {
        await db.insert(schema.tenantInvites).values({
            id: 'invite-old', tenantId: TENANT, email: 'stale@example.test',
            role: 'inspector', status: 'pending', expiresAt: new Date(Date.now() - 1000),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite',
            bundle: membersBundle([{ email: 'stale@example.test', role: 'inspector' }]),
        });
        expect(result.rows[0].conflictWith).toBe('invite-old');
    });

    /**
     * The positive control for the case above: an ACCEPTED invite is outside
     * that index's predicate, so it blocks nothing and is history rather than
     * an outstanding seat.
     */
    it('does not treat an accepted invite as an existing member', async () => {
        await db.insert(schema.tenantInvites).values({
            id: 'invite-done', tenantId: TENANT, email: 'past@example.test',
            role: 'inspector', status: 'accepted', expiresAt: new Date(Date.now() + 1e9),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'members.invite',
            bundle: membersBundle([{ email: 'past@example.test', role: 'inspector' }]),
        });
        expect(result.rows[0].conflictWith).toBeNull();
    });

    it('refuses an overwrite whose export carries more than one template, and says how many', async () => {
        await db.insert(schema.templates).values({
            id: TEMPLATE, tenantId: TENANT, name: 'Live', version: 1,
            schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
        });
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templatesBundle([template('T0'), template('T1'), template('T2')]),
        })).rejects.toThrow(/contains 3 templates/);

        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
    });

    it('refuses an overwrite that names no template to replace', async () => {
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.overwrite',
            bundle: templatesBundle([template('One')]),
        })).rejects.toThrow(/needs the template it is replacing/i);
    });

    it('points an overwrite row at the template the operator was standing on', async () => {
        await db.insert(schema.templates).values({
            id: TEMPLATE, tenantId: TENANT, name: 'Live', version: 1,
            schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.overwrite', targetId: TEMPLATE,
            bundle: templatesBundle([template('One')]),
        });
        expect(result.rows[0].conflictWith).toBe(TEMPLATE);
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, result.batchId)).get();
        expect(batch?.targetId).toBe(TEMPLATE);
        expect(batch?.vendor).toBe('spectora');
    });

    it('leaves a create-templates run with nothing to overwrite', async () => {
        await db.insert(schema.templates).values({
            id: TEMPLATE, tenantId: TENANT, name: 'One', version: 1,
            schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
        });
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.create',
            bundle: templatesBundle([template('One'), template('Two')]),
        });
        expect(result.rows.map((r) => r.conflictWith)).toEqual([null, null]);
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, result.batchId)).get();
        expect(batch?.targetId).toBeNull();
    });

    it('refuses an overwrite aimed at a template of another tenant', async () => {
        await db.insert(schema.tenants).values({
            id: 'other-tenant', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.templates).values({
            id: 'not-mine', tenantId: 'other-tenant', name: 'Theirs', version: 1,
            schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
        });
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'templates.overwrite', targetId: 'not-mine',
            bundle: templatesBundle([template('One')]),
        })).rejects.toThrow(/not found/i);
    });

    it('refuses a bundle carrying entries the entry point never asked for', async () => {
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: bundleFor({
                manifest: manifestFor({ counts: { contact: emitted(1), member: emitted(1) } }),
                contacts: [{ name: 'A', type: 'client' }],
                members: [{ email: 'm@example.test', role: 'inspector' }],
            }),
        })).rejects.toThrow(/1 member/);
    });

    it('refuses a bundle that fails format validation, and reports the issues', async () => {
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: { formatVersion: 1 },
        })).rejects.toThrow(/not a valid migration bundle/i);
    });

    it('refuses a bundle with nothing of the kind the entry point imports', async () => {
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', bundle: bundleFor(),
        })).rejects.toThrow(/no contacts/i);
    });

    it('leaves an earlier batch untouched when staged again', async () => {
        const first = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice', type: 'client' }]),
        });
        const second = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle([{ name: 'Alice', type: 'client' }]),
        });
        expect(second.batchId).not.toBe(first.batchId);
        const batches = await db.select().from(schema.migrationBatches).all();
        expect(batches).toHaveLength(2);
        expect(batches.every((b) => b.status === 'staged')).toBe(true);
    });
});
