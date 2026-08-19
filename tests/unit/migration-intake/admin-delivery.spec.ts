/**
 * Delivering a converted file back into the run it came from.
 *
 * What this route used to be: an endpoint that took our OWN row shapes and
 * inserted them, using the caller's ids as primary keys, skipping any row
 * missing a field and counting only the ones that survived — so a payload of
 * entirely unusable rows returned success with every count at zero.
 *
 * What it is now: the delivery point of the assisted route. It takes a
 * validated bundle, so the format's three rules apply to it — no primary keys
 * of ours, counts that must add up, and every dropped entry named — and the
 * result lands as a staged run the customer reviews and applies themselves.
 *
 * ⚠️ Every delivery assertion states the BEFORE as well as the after, and
 * every one of them is made against a fixture holding a SECOND waiting run.
 * "The batch now holds rows" is true of a batch that already held them, and
 * "some batch was staged" is true when the wrong one was — both would stay
 * green with the delivery deleted.
 *
 * ⚠️ Three guards refuse here and two of them answer 422. So each refusal is
 * asserted on the sentence (and, where the sentence is shared, on the issue
 * that produced it), and each is paired with a positive control: the same
 * request with that single condition lifted, which must succeed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import adminDataImportRoutes from '../../../server/api/admin/admin-data-import';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER_TENANT = '33333333-3333-3333-3333-3333333333c3';
const USER = '22222222-2222-2222-2222-2222222222b2';

interface CountsOver {
    template?: { readFromSource: number; emitted: number; dropped: { at: string; reason: string }[] };
    contact?: { readFromSource: number; emitted: number; dropped: { at: string; reason: string }[] };
    member?: { readFromSource: number; emitted: number; dropped: { at: string; reason: string }[] };
}

function manifest(over: CountsOver = {}) {
    return {
        source: { vendor: 'csv_generic' },
        adapter: { name: 'staff-conversion', version: '1' },
        counts: {
            template: { readFromSource: 0, emitted: 0, dropped: [] },
            contact: { readFromSource: 2, emitted: 2, dropped: [] },
            member: { readFromSource: 0, emitted: 0, dropped: [] },
            ...over,
        },
        warnings: [],
    };
}

function bundle(over: Record<string, unknown> = {}) {
    return {
        formatVersion: 1,
        manifest: manifest(),
        templates: [],
        contacts: [
            { name: 'Alice', email: 'alice@example.test', type: 'client' },
            { name: 'Bob', email: 'bob@example.test', type: 'agent' },
        ],
        members: [],
        ...over,
    };
}

function app() {
    const a = new Hono<HonoConfig>();
    // Mirrors server/index.ts's onError, so a guard's refusal arrives as its
    // status AND its sentence rather than as an undifferentiated 500.
    a.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json(
                { success: false, error: { code: err.code, message: err.message, details: err.details } },
                err.status,
            );
        }
        throw err;
    });
    a.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER, role: 'owner' } as HonoConfig['Variables']['user']);
        c.set('userRole', 'owner');
        c.set('profile', SAAS_PROFILE);
        await next();
    });
    a.route('/', adminDataImportRoutes);
    return a;
}

function post(body: unknown) {
    return app().request(
        '/import',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        { DB: {} },
    );
}

interface Refusal { code: string; message: string; details?: unknown }

/** A Response body reads once, so the refusal is parsed once and passed around. */
async function refusal(res: Response): Promise<Refusal> {
    const body = await res.json() as { error?: Refusal };
    return body.error ?? { code: '(none)', message: '(none)' };
}

function issues(r: Refusal): string[] {
    return (r.details as { issues?: string[] } | undefined)?.issues ?? [];
}

interface Delivered { batchId: string; rows: number; byEntity: { template: number; contact: number; member: number } }

async function delivered(res: Response): Promise<Delivered> {
    const body = await res.json() as { data: Delivered };
    return body.data;
}

describe('POST /api/admin/import — delivering a converted bundle', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let batchId: string;
    /** A second run, also waiting, also this tenant's. Never delivered into. */
    let decoyId: string;

    async function statusOf(id: string): Promise<string | undefined> {
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, id)).get();
        return row?.status;
    }

    async function rowCountOf(id: string): Promise<number> {
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, id)).all();
        return rows.length;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The delivery path batches its update and its row inserts, and
        // better-sqlite3 is the one Drizzle driver with no `batch()`.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        for (const id of [TENANT, OTHER_TENANT]) {
            await db.insert(schema.tenants).values({
                id, slug: id.slice(0, 8), status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
        await db.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'owner@example.test',
            passwordHash: 'x', role: 'owner', createdAt: new Date(),
        });
        const svc = new MigrationStageService({} as D1Database);
        const open = (key: string) => svc.createAssistanceBatch({
            tenantId: TENANT, createdBy: USER, intent: 'assisted.full',
            sourceKey: `${TENANT}/migrations/${key}/source.csv`,
            expiresAt: new Date(Date.now() + 1e9),
            uploadAuthorizedBy: USER, staffAccessAuthorizedBy: USER,
        });
        batchId = (await open('x')).batchId;
        decoyId = (await open('y')).batchId;
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('turns the waiting run — that one — into a staged one, and writes nothing to a real table', async () => {
        expect(await statusOf(batchId)).toBe('needs_assistance');
        expect(await rowCountOf(batchId)).toBe(0);
        expect(await statusOf(decoyId)).toBe('needs_assistance');
        expect(await rowCountOf(decoyId)).toBe(0);

        const res = await post({ batchId, bundle: bundle() });
        expect(res.status).toBe(200);
        expect(await delivered(res)).toMatchObject({ batchId, rows: 2 });

        expect(await statusOf(batchId)).toBe('staged');
        expect(await rowCountOf(batchId)).toBe(2);
        // The other waiting run is untouched: "a batch was staged" is not the
        // claim, "this batch was staged" is.
        expect(await statusOf(decoyId)).toBe('needs_assistance');
        expect(await rowCountOf(decoyId)).toBe(0);
        // The customer presses apply, not us.
        expect(await db.select().from(schema.contacts).all()).toEqual([]);
    });

    it('reports what the run carries, split by kind', async () => {
        const res = await post({
            batchId,
            bundle: bundle({
                manifest: manifest({ member: { readFromSource: 1, emitted: 1, dropped: [] } }),
                members: [{ email: 'staff@example.test', role: 'inspector' }],
            }),
        });
        expect(res.status).toBe(200);
        expect(await delivered(res)).toEqual({
            batchId,
            rows: 3,
            byEntity: { template: 0, contact: 2, member: 1 },
        });
    });

    it('tells the workspace their run is ready', async () => {
        expect(await db.select().from(schema.notifications).all()).toEqual([]);

        await post({ batchId, bundle: bundle() });

        const notes = await db.select().from(schema.notifications).all();
        expect(notes).toHaveLength(1);
        expect(notes[0]?.entityId).toBe(batchId);
        expect(notes[0]?.entityType).toBe('migration_batch');
    });

    it('refuses a bundle whose counts do not add up, instead of importing what survived', async () => {
        const uncounted = manifest({
            // Says five were read, two emitted, and names nothing dropped.
            contact: { readFromSource: 5, emitted: 2, dropped: [] },
        });
        const res = await post({ batchId, bundle: bundle({ manifest: uncounted }) });

        expect(res.status).toBe(422);
        const refused = await refusal(res);
        expect(refused.message).toBe('That file is not a valid migration bundle.');
        // Which of the two 422 guards: the counting rule, named on the count.
        expect(issues(refused)).toEqual([
            expect.stringContaining('manifest.counts.contact: contact: readFromSource (5) must equal emitted (2)'),
        ]);
        expect(await statusOf(batchId)).toBe('needs_assistance');
        expect(await rowCountOf(batchId)).toBe(0);

        // Positive control: the same delivery with the count corrected lands.
        const ok = await post({ batchId, bundle: bundle() });
        expect(ok.status).toBe(200);
        expect(await statusOf(batchId)).toBe('staged');
    });

    it('refuses a bundle carrying a primary key of ours', async () => {
        const withOurId = [
            { id: 'vendor-42', name: 'Alice', email: 'alice@example.test', type: 'client' },
            { name: 'Bob', email: 'bob@example.test', type: 'agent' },
        ];
        const res = await post({ batchId, bundle: bundle({ contacts: withOurId }) });

        expect(res.status).toBe(422);
        const refused = await refusal(res);
        expect(refused.message).toBe('That file is not a valid migration bundle.');
        // Which of the two 422 guards: the id rule, located at the entry.
        const named = issues(refused);
        expect(named).toHaveLength(1);
        expect(named[0]).toContain('contacts.0');
        expect(named[0]).toContain('id');
        expect(await statusOf(batchId)).toBe('needs_assistance');
        expect(await rowCountOf(batchId)).toBe(0);

        // Positive control: the same two contacts, minus the id, land.
        const ok = await post({ batchId, bundle: bundle() });
        expect(ok.status).toBe(200);
        expect((await delivered(ok)).rows).toBe(2);
    });

    it('refuses delivery into a run that is not waiting', async () => {
        // Positive control first, and it is the thing that creates the
        // condition: the run is only "not waiting" because a delivery landed.
        const first = await post({ batchId, bundle: bundle() });
        expect(first.status).toBe(200);

        const res = await post({ batchId, bundle: bundle() });
        expect(res.status).toBe(409);
        expect((await refusal(res)).message).toBe('This import is not waiting for a converted file.');
        // Not doubled up by a second delivery that half-landed.
        expect(await rowCountOf(batchId)).toBe(2);
    });

    it("refuses delivery into another workspace's run", async () => {
        await db.update(schema.migrationBatches).set({ tenantId: OTHER_TENANT })
            .where(eq(schema.migrationBatches.id, batchId));

        const res = await post({ batchId, bundle: bundle() });
        expect(res.status).toBe(404);
        expect((await refusal(res)).message).toBe('Migration batch not found');
        expect(await statusOf(batchId)).toBe('needs_assistance');
        expect(await rowCountOf(batchId)).toBe(0);

        // Positive control: the same request, the same waiting run, once it is
        // this workspace's again.
        await db.update(schema.migrationBatches).set({ tenantId: TENANT })
            .where(eq(schema.migrationBatches.id, batchId));
        const ok = await post({ batchId, bundle: bundle() });
        expect(ok.status).toBe(200);
    });

    it('refuses a run id nothing answers to, rather than opening one', async () => {
        const res = await post({ batchId: 'no-such-run', bundle: bundle() });
        expect(res.status).toBe(404);
        expect((await refusal(res)).message).toBe('Migration batch not found');
        const all = await db.select().from(schema.migrationBatches).all();
        expect(all).toHaveLength(2);
    });
});
