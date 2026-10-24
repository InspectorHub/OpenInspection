/**
 * Legacy finding keys and a results document that already exists (workerd).
 *
 * The problem, in the order it happens: a result was recorded under the bare
 * item id; the inspection was opened in the editor, so its Durable Object
 * imported the blob (bare keys verbatim) and seeded EMPTY composite items from
 * the template; then the keys were migrated in D1 only. The document, which has
 * stored state and so never re-imports D1, shows empty composite items, and its
 * next persist replaces the migrated blob with its own projection.
 *
 * `the old D1-only migration` pins that as the behaviour the old path had.
 * `the rename-legacy-keys verb` is the fix: same start, but the document renames
 * its own keys. Both start from the same fixture, so the contrast is the point.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as Y from 'yjs';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspectionResults } from '../../server/lib/db/schema';
import { Hono } from 'hono';
import { INSPECTION_RESULTS_TEST_DDL, TENANT_CONFIGS_TEST_DDL } from '../helpers/inline-ddl';
import adminFindingKeyRoutes from '../../server/api/admin/admin-finding-keys';
import type { HonoConfig } from '../../server/types/hono';
import { applyItemPatch, projectResults } from '@core/field-ui/shared/results-doc';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';

const b = env as unknown as {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
};

const TENANT = 'tenant-legacy-keys';
const COMPOSITE = '_default:s1:roof';
const SIGNATURE = { signatureBase64: 'sig', signedAt: 1 };
const LEGACY_BLOB = {
    roof: { rating: 'D', notes: 'Flashing lifted', photos: [{ key: 't/p1.jpg' }] },
    _inspector_signature: SIGNATURE,
};

interface DOInternals {
    doc: Y.Doc;
    tenantId: string | null;
    inspectionId: string | null;
    reportId: string | null;
    identityPersisted: boolean;
    hadStoredState: boolean;
    d1HydrationPromise: Promise<void> | null;
    persist(): Promise<void>;
    hydrateFromD1Once(): Promise<void>;
}

async function seedSchema(): Promise<void> {
    await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_id TEXT, template_snapshot TEXT);');
    await b.DB.exec(TENANT_CONFIGS_TEST_DDL);
}

interface Fixture {
    inspectionId: string;
    reportId: string;
    stub: DurableObjectStub<InspectionDocDO>;
    headers: Record<string, string>;
}

/** An inspection whose results row still holds the legacy blob, with a DO addressed the way the collab routes address it. */
async function legacyInspection(blob: object = LEGACY_BLOB): Promise<Fixture> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const inspectionId = `insp-${suffix}`;
    const reportId = `rpt-${suffix}`;
    await b.DB.prepare('INSERT INTO inspections (id, tenant_id, template_snapshot) VALUES (?, ?, ?)')
        .bind(inspectionId, TENANT, JSON.stringify({ sections: [{ id: 's1', items: [{ id: 'roof' }, { id: 'attic' }] }] })).run();
    await b.DB.prepare('INSERT INTO inspection_results (id, tenant_id, inspection_id, report_id, data, last_synced_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), TENANT, inspectionId, reportId, JSON.stringify(blob), Date.now()).run();
    return {
        inspectionId,
        reportId,
        stub: b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${reportId}`)),
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': inspectionId, 'x-report-id': reportId },
    };
}

/** The document as a first connect leaves it: legacy content imported verbatim, composite items seeded empty, state stored. */
async function openedInEditor(f: Fixture): Promise<void> {
    await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
        const io = instance as unknown as DOInternals;
        io.tenantId = TENANT;
        io.inspectionId = f.inspectionId;
        io.reportId = f.reportId;
        io.identityPersisted = true;
        await io.hydrateFromD1Once();
        await io.persist();
    });
}

async function blobOf(f: Fixture): Promise<Record<string, Record<string, unknown>>> {
    const row = await b.DB.prepare('SELECT data, ydoc_state FROM inspection_results WHERE tenant_id = ? AND report_id = ?')
        .bind(TENANT, f.reportId).first<{ data: string }>();
    return JSON.parse(row?.data ?? '{}') as Record<string, Record<string, unknown>>;
}

async function projection(f: Fixture): Promise<ResultsProjection> {
    return runInDurableObject(f.stub, (instance: InspectionDocDO) => projectResults((instance as unknown as DOInternals).doc));
}

/** What the migration used to do to a blob: move the bare entry onto the composite key, in D1 only. */
async function oldD1OnlyMigration(f: Fixture): Promise<void> {
    const { roof, ...rest } = await blobOf(f);
    await drizzle(b.DB).update(inspectionResults)
        .set({ data: { ...rest, [COMPOSITE]: roof } })
        .where(and(eq(inspectionResults.tenantId, TENANT), eq(inspectionResults.reportId, f.reportId)));
}

async function persistAnEdit(f: Fixture): Promise<void> {
    await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
        const io = instance as unknown as DOInternals;
        applyItemPatch(io.doc, '_default:s1:attic', 'notes', 'edited after the migration');
        await io.persist();
    });
}

beforeAll(seedSchema);
beforeEach(async () => {
    await b.DB.exec('DELETE FROM inspection_results;');
    await b.DB.exec('DELETE FROM inspections;');
    await b.DB.exec('DELETE FROM tenant_configs;');
});

describe('a document opened before the keys were migrated', () => {
    it('holds the legacy content under the bare key and nothing under the composite one', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);

        const proj = await projection(f);
        expect(proj.roof).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect(proj[COMPOSITE]).toEqual({});
    });
});

describe('the old D1-only migration', () => {
    it('is undone by the next persist: the bare keys return and the composite items stay empty', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);

        // What the migration used to do: rewrite the blob in D1 and nothing else.
        await oldD1OnlyMigration(f);
        expect((await blobOf(f))[COMPOSITE]).toMatchObject({ rating: 'D' });

        // The document does not re-import D1, so it still shows the empty item, and persisting it wins.
        await persistAnEdit(f);

        const after = await blobOf(f);
        expect(after.roof).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect(after[COMPOSITE]).toEqual({});
        expect(after._default).toBeUndefined();
    });
});

describe('the rename-legacy-keys verb', () => {
    const rename = (f: Fixture) => f.stub.fetch(new Request('https://do.local/rename-legacy-keys', { method: 'POST', headers: f.headers }));

    it('moves the content onto the composite key in the document and in the persisted blob', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        const before = (await projection(f)).roof;

        const res = await rename(f);

        expect(res.status).toBe(200);
        // The signature is meta: the document never imported it, so there is none to skip.
        expect(await res.json()).toEqual({ renamed: 1, skippedMeta: 0, skippedUnknown: 0, skippedAmbiguous: 0, conflicts: 0 });
        const proj = await projection(f);
        expect(proj[COMPOSITE]).toEqual(before);
        expect('roof' in proj).toBe(false);

        const blob = await blobOf(f);
        expect(blob[COMPOSITE]).toEqual(before);
        expect('roof' in blob).toBe(false);
    });

    it('survives a further persist, which is where the old migration lost its work', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        await rename(f);
        await persistAnEdit(f);

        const blob = await blobOf(f);
        expect(blob[COMPOSITE]).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect('roof' in blob).toBe(false);
    });

    it('is idempotent', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        await rename(f);
        const settled = await blobOf(f);

        const again = await (await rename(f)).json();

        expect(again).toMatchObject({ renamed: 0, conflicts: 0 });
        expect(await blobOf(f)).toEqual(settled);
    });

    it('answers 400 without an identity and 404 for other methods, touching nothing', async () => {
        const f = await legacyInspection();
        const bare = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${f.reportId}-nobody`));
        expect((await bare.fetch(new Request('https://do.local/rename-legacy-keys', { method: 'POST' }))).status).toBe(400);
        expect((await f.stub.fetch(new Request('https://do.local/rename-legacy-keys', { method: 'GET', headers: f.headers }))).status).toBe(404);
        expect(await blobOf(f)).toEqual(LEGACY_BLOB);
    });
});

describe('the divergence log line', () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => warn.mockRestore());

    const divergenceLines = (): Array<{ message: string; data: Record<string, unknown> }> =>
        warn.mock.calls
            .map((c) => { try { return JSON.parse(String(c[0])) as { message: string; data: Record<string, unknown> }; } catch { return null; } })
            .filter((l): l is { message: string; data: Record<string, unknown> } => l?.message === 'collab_d1_divergence');

    /** Hydrate again as a reconstructed object that found stored state would. */
    async function rehydrateWithStoredState(f: Fixture): Promise<void> {
        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            io.hadStoredState = true;
            io.d1HydrationPromise = null;
            await io.hydrateFromD1Once();
        });
    }

    it('is written once, with the inspection id and a count and nothing else, and changes nothing', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        await oldD1OnlyMigration(f);
        const docBefore = await projection(f);
        const blobBefore = await blobOf(f);
        warn.mockClear();

        await rehydrateWithStoredState(f);

        const lines = divergenceLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]?.data).toEqual({ inspectionId: f.inspectionId, divergentFindings: 1 });
        expect(JSON.stringify(lines[0])).not.toContain('Flashing lifted');
        expect(await projection(f)).toEqual(docBefore);
        expect(await blobOf(f)).toEqual(blobBefore);
    });

    it('stays silent when the blob and the document agree', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        warn.mockClear();

        await rehydrateWithStoredState(f);

        expect(divergenceLines()).toHaveLength(0);
    });

    it('is not written on the first hydration, which imports the blob instead of ignoring it', async () => {
        const f = await legacyInspection();
        warn.mockClear();
        await openedInEditor(f);
        expect(divergenceLines()).toHaveLength(0);
    });
});

describe('the rename-legacy-keys verb: the blob is composite and the document is not', () => {
    const rename = (f: Fixture) => f.stub.fetch(new Request('https://do.local/rename-legacy-keys', { method: 'POST', headers: f.headers }));
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => warn.mockRestore());

    const lines = (message: string): Array<{ message: string; data: Record<string, unknown> }> =>
        warn.mock.calls
            .map((c) => { try { return JSON.parse(String(c[0])) as { message: string; data: Record<string, unknown> }; } catch { return null; } })
            .filter((l): l is { message: string; data: Record<string, unknown> } => l?.message === message);

    async function snapshots(f: Fixture): Promise<Array<{ seq: number; reason?: string }>> {
        return (await f.stub.fetch(new Request('https://do.local/snapshots', { headers: f.headers }))).json();
    }

    it('renames inside the document and leaves document and persisted blob composite, which a D1-only migration could not', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        await oldD1OnlyMigration(f);
        expect((await blobOf(f))[COMPOSITE]).toMatchObject({ rating: 'D' });
        expect('roof' in await blobOf(f)).toBe(false);

        const res = await rename(f);

        expect(await res.json()).toMatchObject({ renamed: 1, conflicts: 0 });
        const proj = await projection(f);
        expect(proj[COMPOSITE]).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect('roof' in proj).toBe(false);
        await persistAnEdit(f);
        const blob = await blobOf(f);
        expect(blob[COMPOSITE]).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect('roof' in blob).toBe(false);
    });

    it('takes a pre-rename snapshot holding the bare keys first, and none when there is nothing to rename', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        const before = (await snapshots(f)).length;

        await rename(f);

        const after = await snapshots(f);
        expect(after).toHaveLength(before + 1);
        const taken = after.find((s) => s.reason === 'pre-rename');
        expect(taken).toBeDefined();
        const full = await (await f.stub.fetch(new Request(`https://do.local/snapshots/${taken?.seq}`, { headers: f.headers }))).json() as { projection: ResultsProjection };
        expect(full.projection.roof).toMatchObject({ rating: 'D' });
        expect(full.projection[COMPOSITE]).toEqual({});

        await rename(f);
        expect(await snapshots(f)).toHaveLength(before + 1);
    });

    it('writes one numbers-only log line with the counts, conflicts included', async () => {
        const f = await legacyInspection();
        await openedInEditor(f);
        await runInDurableObject(f.stub, (instance: InspectionDocDO) => {
            applyItemPatch((instance as unknown as DOInternals).doc, COMPOSITE, 'notes', 'someone typed this in the new structure');
        });
        warn.mockClear();

        const counts = await (await rename(f)).json();

        expect(counts).toMatchObject({ renamed: 1, conflicts: 1 });
        const logged = lines('collab_legacy_keys_renamed');
        expect(logged).toHaveLength(1);
        expect(logged[0]?.data).toEqual({ inspectionId: f.inspectionId, renamed: 1, conflicts: 1 });
        expect((await projection(f))[COMPOSITE]?.notes).toBe('someone typed this in the new structure');

        warn.mockClear();
        await rename(f);
        expect(lines('collab_legacy_keys_renamed')).toHaveLength(0);
    });
});

describe('the admin route, through a real INSPECTION_DOC stub', () => {
    const app = new Hono<HonoConfig>()
        .use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'owner');
            c.set('user', { sub: 'owner-1' } as never);
            await next();
        })
        .route('/', adminFindingKeyRoutes);

    const migrate = async () => {
        const res = await app.request('/migrate-finding-keys', { method: 'POST' }, env);
        expect(res.status).toBe(200);
        return (await res.json() as { data: Record<string, unknown> }).data;
    };

    const hasState = async (f: Fixture) =>
        (await b.DB.prepare('SELECT ydoc_state IS NOT NULL AS s FROM inspection_results WHERE report_id = ?').bind(f.reportId).first<{ s: number }>())?.s === 1;

    it('repairs a document whose blob an older migration already made composite', async () => {
        const f = await legacyInspection({ roof: { rating: 'D', notes: 'Flashing lifted' } });
        await openedInEditor(f);
        await oldD1OnlyMigration(f);

        const data = await migrate();

        expect(data).toMatchObject({ processed: 1, migrated: 0, delegated: 1, failed: 0, failedIds: [], renamedInDocuments: 1, conflicts: 0 });
        const proj = await projection(f);
        expect(proj[COMPOSITE]).toMatchObject({ rating: 'D' });
        expect('roof' in proj).toBe(false);
        const blob = await blobOf(f);
        expect(blob[COMPOSITE]).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect('roof' in blob).toBe(false);

        // Idempotent: the document is asked again, has nothing left, and nothing changes.
        expect(await migrate()).toMatchObject({ delegated: 1, renamedInDocuments: 0, failed: 0 });
        expect(await blobOf(f)).toEqual(blob);
    });

    it('sends a row that has no document yet to its document, which imports the blob, renames and persists', async () => {
        const f = await legacyInspection({ roof: { rating: 'D', notes: 'Flashing lifted' } });
        expect(await hasState(f)).toBe(false);

        const data = await migrate();

        expect(data).toMatchObject({ migrated: 0, delegated: 1, renamedInDocuments: 1 });
        expect(await hasState(f)).toBe(true);
        const blob = await blobOf(f);
        expect(blob[COMPOSITE]).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect('roof' in blob).toBe(false);
    });

    it('rewrites in D1 when the tenant switched collaboration off', async () => {
        await b.DB.prepare('INSERT INTO tenant_configs (tenant_id, is_collab_editing_enabled, updated_at) VALUES (?, 0, 1)').bind(TENANT).run();
        const f = await legacyInspection({ roof: { rating: 'D' } });

        const data = await migrate();

        expect(data).toMatchObject({ migrated: 1, delegated: 0 });
        expect(await hasState(f)).toBe(false);
        expect(Object.keys(await blobOf(f))).toEqual(['_default:s1:roof']);
    });
});

describe('the divergence log line on an inspection with several reports', () => {
    let warn: MockInstance<typeof console.warn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => warn.mockRestore());

    it('compares the document with its own report, not with a sibling row the hydration read happened to reach first', async () => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const inspectionId = `insp-multi-${suffix}`;
        const reportId = `rpt-mine-${suffix}`;
        await b.DB.prepare('INSERT INTO inspections (id, tenant_id, template_snapshot) VALUES (?, ?, ?)')
            .bind(inspectionId, TENANT, JSON.stringify({ sections: [{ id: 's1', items: [{ id: 'roof' }, { id: 'attic' }] }] })).run();
        // The sibling's row is inserted first, so it is the one an inspection-wide read reaches.
        await b.DB.prepare('INSERT INTO inspection_results (id, tenant_id, inspection_id, report_id, data, last_synced_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), TENANT, inspectionId, `rpt-sibling-${suffix}`, JSON.stringify({ attic: { rating: 'S', notes: 'belongs to the other report' } }), Date.now()).run();
        await b.DB.prepare('INSERT INTO inspection_results (id, tenant_id, inspection_id, report_id, data, last_synced_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), TENANT, inspectionId, reportId, '{}', Date.now()).run();
        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${reportId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            io.tenantId = TENANT;
            io.inspectionId = inspectionId;
            io.reportId = reportId;
            io.identityPersisted = true;
            io.hadStoredState = true; // no import: the document is the one that has the state
            await io.hydrateFromD1Once();
            applyItemPatch(io.doc, COMPOSITE, 'rating', 'D');
            await io.persist(); // this report's row now equals the document
            warn.mockClear();

            io.d1HydrationPromise = null;
            await io.hydrateFromD1Once();
        });

        expect(warn.mock.calls.filter((c) => String(c[0]).includes('collab_d1_divergence'))).toHaveLength(0);
    });
});

describe('meta keys survive the document persist', () => {
    const OTHER_META = { note: 'kept too' };
    const withMeta = { roof: { rating: 'D', notes: 'Flashing lifted' }, _inspector_signature: SIGNATURE, _other_meta: OTHER_META };

    async function persistEdit(f: Fixture, edit: (doc: Y.Doc) => void = () => undefined): Promise<void> {
        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            applyItemPatch(io.doc, '_default:s1:attic', 'notes', 'edited');
            edit(io.doc);
            await io.persist();
        });
    }

    it('keeps the signature of a blob the document imported, across the first persist and a later edit', async () => {
        const f = await legacyInspection(withMeta);
        await openedInEditor(f); // import + persist
        expect((await blobOf(f))._inspector_signature).toEqual(SIGNATURE);

        await persistEdit(f);

        const blob = await blobOf(f);
        expect(blob._inspector_signature).toEqual(SIGNATURE);
        expect(blob._other_meta).toEqual(OTHER_META);
    });

    it('never puts a meta key into the document', async () => {
        const f = await legacyInspection(withMeta);
        await openedInEditor(f);
        const keys = await runInDurableObject(f.stub, (instance: InspectionDocDO) => [...(instance as unknown as DOInternals).doc.getMap('results').keys()]);
        expect(keys.filter((k) => k.startsWith('_') && !k.startsWith('_default:'))).toEqual([]);
        expect(Object.keys(await projection(f)).filter((k) => k.startsWith('_') && !k.startsWith('_default:'))).toEqual([]);
    });

    it('keeps the signature when a stored document already holds an empty item map for it', async () => {
        const f = await legacyInspection(withMeta);
        await openedInEditor(f);
        await runInDurableObject(f.stub, (instance: InspectionDocDO) => {
            (instance as unknown as DOInternals).doc.getMap<unknown>('results').set('_inspector_signature', new Y.Map<unknown>());
        });
        // The signature is written the way the signing routes write it: straight to the row.
        await b.DB.prepare('UPDATE inspection_results SET data = ? WHERE report_id = ?')
            .bind(JSON.stringify({ ...(await blobOf(f)), _inspector_signature: SIGNATURE }), f.reportId).run();

        await persistEdit(f);

        const blob = await blobOf(f);
        expect(blob._inspector_signature).toEqual(SIGNATURE);
        expect(blob._other_meta).toEqual(OTHER_META);
        expect(Object.keys(await projection(f))).not.toContain('_inspector_signature');
    });

    it('picks up a signature written to the row after the document was opened, and the findings are unchanged', async () => {
        const f = await legacyInspection({ roof: { rating: 'D', notes: 'Flashing lifted' } });
        await openedInEditor(f);
        const before = (await blobOf(f))[COMPOSITE];
        await b.DB.prepare('UPDATE inspection_results SET data = ? WHERE report_id = ?')
            .bind(JSON.stringify({ ...(await blobOf(f)), _inspector_signature: SIGNATURE }), f.reportId).run();

        await persistEdit(f);

        const blob = await blobOf(f);
        expect(blob._inspector_signature).toEqual(SIGNATURE);
        expect(blob.roof).toMatchObject({ rating: 'D', notes: 'Flashing lifted' });
        expect(blob[COMPOSITE]).toEqual(before);
        expect(blob['_default:s1:attic']).toMatchObject({ notes: 'edited' });
    });

    it('does not conjure a meta key for a row that never had one', async () => {
        const f = await legacyInspection({ roof: { rating: 'D' } });
        await openedInEditor(f);
        await persistEdit(f);
        expect(Object.keys(await blobOf(f)).filter((k) => k.startsWith('_') && !k.startsWith('_default:'))).toEqual([]);
    });
});
