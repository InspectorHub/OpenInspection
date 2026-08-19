/**
 * The batch that exists before anything could be read.
 *
 * A file no adapter recognises does not end the run; it starts one in a state
 * that says so. The file stays where it was put, both authorisations are on the
 * row, and when somebody has converted it the SAME batch receives the result —
 * which is what gives the assisted route provenance, a per-row report, resumable
 * apply and an undo, none of which it would get from a separate insert path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const EXPIRES = new Date('2026-11-16T00:00:00.000Z');

function mixedBundle() {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'staff', version: '1' },
            counts: {
                template: { readFromSource: 0, emitted: 0, dropped: [] },
                contact: { readFromSource: 2, emitted: 2, dropped: [] },
                member: { readFromSource: 1, emitted: 1, dropped: [] },
            },
            warnings: [],
        },
        templates: [],
        contacts: [
            { name: 'Alice', email: 'alice@example.test', type: 'client' },
            { name: 'Bob', email: 'bob@example.test', type: 'agent' },
        ],
        members: [{ email: 'staff@example.test', role: 'inspector' }],
    };
}

describe('MigrationStageService — the assisted branch', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let svc: MigrationStageService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The delivery path batches its update and its row inserts, and
        // better-sqlite3 is the one Drizzle driver with no `batch()` — see
        // helpers/d1-binding.ts.
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

    async function createAssistance() {
        return svc.createAssistanceBatch({
            tenantId: TENANT,
            createdBy: USER,
            intent: 'assisted.full',
            sourceKey: `${TENANT}/migrations/x/source.csv`,
            expiresAt: EXPIRES,
            uploadAuthorizedBy: USER,
            staffAccessAuthorizedBy: USER,
        });
    }

    it('creates a batch that is waiting, with no rows and both authorisations', async () => {
        const { batchId } = await createAssistance();
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, batchId)).get();
        expect(batch?.status).toBe('needs_assistance');
        expect(batch?.intent).toBe('assisted.full');
        expect(batch?.sourceKey).toBe(`${TENANT}/migrations/x/source.csv`);
        expect(batch?.expiresAt?.getTime()).toBe(EXPIRES.getTime());
        expect(batch?.uploadAuthorizedBy).toBe(USER);
        expect(batch?.uploadAuthorizedAt).toBeInstanceOf(Date);
        expect(batch?.uploadAuthorizationVersion).toBe('1');
        expect(batch?.staffAccessAuthorizedBy).toBe(USER);
        expect(batch?.staffAccessAuthorizedAt).toBeInstanceOf(Date);
        expect(batch?.staffAccessAuthorizationVersion).toBe('1');
        // The positive control for this emptiness is the delivery test below,
        // which writes three rows through the same tables.
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
    });

    it('accepts a bundle into that same batch and turns it into a staged run', async () => {
        const { batchId } = await createAssistance();
        const result = await svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS,
        });

        expect(result.batchId).toBe(batchId);
        expect(result.rows).toHaveLength(3);

        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, batchId)).get();
        expect(batch?.status).toBe('staged');
        // Provenance comes from the delivered bundle, replacing the placeholder
        // the waiting batch carried.
        expect(batch?.adapterName).toBe('staff');
        expect(batch?.sourceKey).toBe(`${TENANT}/migrations/x/source.csv`);
    });

    it('leaves the waiting batch carrying a placeholder provenance, not a guess', async () => {
        // The control for the assertion above: without this, "adapterName is
        // 'staff' after delivery" would also pass if the waiting row had been
        // written with 'staff' from the start.
        const { batchId } = await createAssistance();
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, batchId)).get();
        expect(batch?.adapterName).toBe('none');
        expect(batch?.adapterVersion).toBe('0');
    });

    it('numbers positions within each entity family, not across the batch', async () => {
        const { batchId } = await createAssistance();
        await svc.stageIntoBatch({ tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS });
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
        const contacts = rows.filter((r) => r.entity === 'contact').map((r) => r.position).sort();
        const members = rows.filter((r) => r.entity === 'member').map((r) => r.position).sort();
        expect(contacts).toEqual([0, 1]);
        expect(members).toEqual([0]);
    });

    it('keeps each entry with its own family and index, so (entity, position) is the identity', async () => {
        // Numbering per family is only meaningful if the payload at
        // (contact, 0) is the first contact of the file rather than whichever
        // entry happened to be written first.
        const { batchId } = await createAssistance();
        await svc.stageIntoBatch({ tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS });
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
        const at = (entity: string, position: number) =>
            JSON.parse(rows.find((r) => r.entity === entity && r.position === position)?.payload ?? 'null');
        expect(at('contact', 0)).toEqual({ name: 'Alice', email: 'alice@example.test', type: 'client' });
        expect(at('contact', 1)).toEqual({ name: 'Bob', email: 'bob@example.test', type: 'agent' });
        expect(at('member', 0)).toEqual({ email: 'staff@example.test', role: 'inspector' });
    });

    it('lets an assisted bundle carry every family, unlike a named entry point', async () => {
        const { batchId } = await createAssistance();
        const result = await svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS,
        });
        expect(new Set(result.rows.map((r) => r.entity))).toEqual(new Set(['contact', 'member']));
    });

    it('still resolves conflicts per family on a delivered bundle', async () => {
        // Delivery is not a bulk insert with the checks skipped: an address the
        // workspace already holds is a clash whichever route brought it in.
        await db.insert(schema.contacts).values({
            id: 'existing-1', tenantId: TENANT, type: 'client', name: 'Alice Old',
            email: 'ALICE@example.test', createdAt: new Date(),
        });
        const { batchId } = await createAssistance();
        const result = await svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS,
        });
        const contactRow = (position: number) =>
            result.rows.find((r) => r.entity === 'contact' && r.position === position);
        expect(contactRow(0)?.conflictWith).toBe('existing-1');
        expect(contactRow(1)?.conflictWith).toBeNull();
    });

    it('refuses to deliver into a batch that is not waiting', async () => {
        const { batchId } = await createAssistance();
        await svc.stageIntoBatch({ tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS });
        await expect(svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS,
        })).rejects.toThrow(/not waiting/i);
        // And the refusal wrote nothing: the batch still holds one delivery.
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, batchId)).all();
        expect(rows).toHaveLength(3);
    });

    it('refuses to deliver into another tenant batch', async () => {
        const { batchId } = await createAssistance();
        await expect(svc.stageIntoBatch({
            tenantId: 'someone-else', batchId, bundle: mixedBundle(), limits: LIMITS,
        })).rejects.toThrow(/not found/i);
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);
    });

    it('still enforces the row cap on a delivered bundle', async () => {
        const { batchId } = await createAssistance();
        await expect(svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(),
            limits: { maxCsvBytes: 1_000_000, maxVendorExportBytes: 2_000_000, maxRows: 2 },
        })).rejects.toThrow(/3 entries and one import can carry 2/);
    });

    it('refuses to open an assisted run through the ordinary staging path', async () => {
        // The ordinary path takes neither the file's location nor either
        // authorisation, so an assisted run opened there would end up with rows
        // and no record of whose file they came from or who agreed to it being
        // kept. The two-step route below is the only one that can carry them,
        // which is why this is a refusal rather than a second way in.
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'assisted.full',
            bundle: mixedBundle(), limits: LIMITS,
        })).rejects.toThrow(/kind is known/i);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);

        // The control: the very same bundle is accepted, through the route that
        // records those things. The refusal is about the door, not the file.
        const { batchId } = await createAssistance();
        const result = await svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS,
        });
        expect(result.rows).toHaveLength(3);
    });

    it('still enforces the entry point on a NAMED intent that went through assistance', async () => {
        const { batchId } = await svc.createAssistanceBatch({
            tenantId: TENANT,
            createdBy: USER,
            intent: 'contacts.import',
            sourceKey: `${TENANT}/migrations/y/source.csv`,
            expiresAt: EXPIRES,
            uploadAuthorizedBy: USER,
            staffAccessAuthorizedBy: USER,
        });
        await expect(svc.stageIntoBatch({
            tenantId: TENANT, batchId, bundle: mixedBundle(), limits: LIMITS,
        })).rejects.toThrow(/1 member/);
    });
});
