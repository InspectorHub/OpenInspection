/**
 * #181 Phase 4 — DO projection snapshots + doc-replacement restore (workerd).
 *
 * Validates the production InspectionDocDO snapshot model under the real
 * workerd isolate via runInDurableObject. Drives captureSnapshot /
 * listSnapshots / restoreSnapshot through the DOInternals cast (same harness
 * style as collab-multiclient.spec.ts).
 *
 * Scenarios:
 *   1. Restore reverts the projection (the POC's previously-failing case).
 *   2. Nested-field restore (defect + photo round-trip through restore).
 *   3. List metadata: newest-first, capped, no `projection` key.
 *   4. Restore is reversible (pre-restore state is itself snapshotted).
 *   5. Unknown seq → { ok: false }, doc unchanged.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
    seedResultsDoc,
    applyItemPatch,
    projectResults,
    appendPhoto,
    upsertCanned,
} from '../../server/lib/collab/results-doc';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import type { ResultsProjection } from '../../server/lib/collab/results-doc.types';

// ─── Bindings ─────────────────────────────────────────────────────────────────

interface TestBindings {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as unknown as TestBindings;

// ─── Schema seeding (mirrors collab-multiclient.spec.ts) ───────────────────────

async function seedSchema(): Promise<void> {
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspection_results (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, inspection_id TEXT NOT NULL, data TEXT NOT NULL, ydoc_state BLOB, last_synced_at INTEGER NOT NULL, rating_system_id TEXT, rating_system_snapshot TEXT);');
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
}

async function clearResults(): Promise<void> {
    await b.DB.exec('DELETE FROM inspection_results;');
    await b.DB.exec('DELETE FROM inspections;');
}

async function ensureResultsRow(tenantId: string, inspectionId: string): Promise<void> {
    await b.DB
        .prepare(
            'INSERT OR IGNORE INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), tenantId, inspectionId, '{}', Date.now())
        .run();
}

async function readResultsData(
    tenantId: string,
    inspectionId: string,
): Promise<Record<string, unknown>> {
    const row = await b.DB
        .prepare('SELECT data FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?')
        .bind(tenantId, inspectionId)
        .first<{ data: string }>();
    if (!row) return {};
    return JSON.parse(row.data) as Record<string, unknown>;
}

// ─── DOInternals — typed access to the snapshot/restore members under test ─────

type SnapshotReason = 'periodic' | 'manual' | 'connect';

interface SnapshotMeta {
    seq:      number;
    atMs:     number;
    byUserId: string | null;
    reason?:  SnapshotReason;
}

interface SnapshotRecord extends SnapshotMeta {
    projection: ResultsProjection;
}

interface DOInternals {
    doc: Y.Doc;
    tenantId: string | null;
    inspectionId: string | null;
    identityPersisted: boolean;
    hadStoredState: boolean;
    persist(): Promise<void>;
    captureSnapshot(
        byUserId: string | null,
        reason?: SnapshotReason,
    ): Promise<{ seq: number; atMs: number }>;
    captureSnapshotOnConnect(byUserId: string | null): Promise<void>;
    getSnapshot(seq: number): Promise<SnapshotRecord | null>;
    listSnapshots(): Promise<SnapshotMeta[]>;
    restoreSnapshot(seq: number, byUserId: string | null): Promise<{ ok: boolean }>;
}

function setIdentity(io: DOInternals, tenantId: string, inspectionId: string): void {
    io.tenantId          = tenantId;
    io.inspectionId      = inspectionId;
    io.identityPersisted = true;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const TENANT = 'test-tenant-restore';
const FINDING_KEY_A = '_default:sec1:item1';

describe('#181 Phase 4 — DO snapshots + doc-replacement restore', () => {
    beforeAll(seedSchema);
    beforeEach(clearResults);

    // ── Scenario 1: Restore reverts the projection ────────────────────────────
    it('Scenario 1 — restore reverts the projection (POC previously-failing case)', async () => {
        const inspectionId = 'insp-revert-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);

            // V1: rating NI → snapshot.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');
            const snapV1 = await io.captureSnapshot(null);

            // V2: rating RR.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'RR');
            expect(projectResults(io.doc)[FINDING_KEY_A]?.rating).toBe('RR');

            // Restore V1.
            const out = await io.restoreSnapshot(snapV1.seq, 'u-restorer');
            expect(out.ok).toBe(true);

            // Doc-replacement: the live doc is back to NI.
            expect(projectResults(io.doc)[FINDING_KEY_A]?.rating).toBe('NI');

            // restoreSnapshot already persisted, but persist again to be explicit.
            await io.persist();
        });

        const d1Data = await readResultsData(TENANT, inspectionId);
        const item = d1Data[FINDING_KEY_A] as Record<string, unknown> | undefined;
        expect(item?.rating).toBe('NI');
    });

    // ── Scenario 2: Nested-field restore ──────────────────────────────────────
    it('Scenario 2 — nested-field restore brings back defect + photo', async () => {
        const inspectionId = 'insp-nested-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);

            // V1: a defect (with location) + a photo.
            appendPhoto(io.doc, FINDING_KEY_A, { key: 'r2/snap-1.jpg', mediaType: 'photo' });
            upsertCanned(io.doc, FINDING_KEY_A, 'defects', {
                cannedId: 'd1',
                included: true,
                location: 'North wall',
                trade:    'Roofing',
            });
            const snapV1 = await io.captureSnapshot(null);

            // Sanity: V1 has the nested fields.
            const v1 = projectResults(io.doc);
            expect(v1[FINDING_KEY_A]?.photos).toEqual([{ key: 'r2/snap-1.jpg', mediaType: 'photo' }]);

            // V2: clear them (remove photo, remove defect).
            io.doc.transact(() => {
                const results = io.doc.getMap<unknown>('results');
                const item = results.get(FINDING_KEY_A) as Y.Map<unknown>;
                const photos = item.get('photos') as Y.Array<unknown>;
                photos.delete(0, photos.length);
                const tabs = item.get('tabs') as Y.Map<unknown>;
                const defects = tabs.get('defects') as Y.Array<unknown>;
                defects.delete(0, defects.length);
            });
            const v2 = projectResults(io.doc);
            expect(v2[FINDING_KEY_A]?.photos).toBeUndefined();
            expect(v2[FINDING_KEY_A]?.tabs).toBeUndefined();

            // Restore V1.
            const out = await io.restoreSnapshot(snapV1.seq, null);
            expect(out.ok).toBe(true);

            // Nested fields are back.
            const restored = projectResults(io.doc);
            expect(restored[FINDING_KEY_A]?.photos).toEqual([
                { key: 'r2/snap-1.jpg', mediaType: 'photo' },
            ]);
            expect(restored[FINDING_KEY_A]?.tabs?.defects).toEqual([
                { cannedId: 'd1', included: true, location: 'North wall', trade: 'Roofing' },
            ]);
        });
    });

    // ── Scenario 3: List metadata — newest-first, capped, no projection key ────
    it('Scenario 3 — listSnapshots is capped, newest-first, omits projection', async () => {
        const inspectionId = 'insp-list-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        const SNAPSHOT_CAP = 25;

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);

            // Capture more than the cap on demand. (Note: the applyItemPatch
            // edits also drive onDocUpdate's auto-snapshot cadence, so the true
            // total is >= the on-demand count — the assertions below do not
            // hardcode an exact seq, only the cap + ordering invariants.)
            const onDemand = SNAPSHOT_CAP + 5;
            let lastSeq = -1;
            for (let i = 0; i < onDemand; i++) {
                applyItemPatch(io.doc, FINDING_KEY_A, 'notes', 'note ' + i);
                const snap = await io.captureSnapshot('u' + i);
                lastSeq = snap.seq;
            }

            const list = await io.listSnapshots();

            // Capped to SNAPSHOT_CAP (oldest dropped).
            expect(list.length).toBe(SNAPSHOT_CAP);

            // Descending seq (newest first), monotonic.
            for (let i = 1; i < list.length; i++) {
                expect(list[i - 1].seq).toBeGreaterThan(list[i].seq);
            }

            // The newest listed seq is the highest seq ever assigned.
            expect(list[0].seq).toBeGreaterThanOrEqual(lastSeq);

            // No `projection` key leaks into the metadata.
            for (const meta of list) {
                expect('projection' in meta).toBe(false);
            }
        });
    });

    // ── Scenario 4: Restore is reversible ─────────────────────────────────────
    it('Scenario 4 — restore captures the pre-restore (V2) state in the list', async () => {
        const inspectionId = 'insp-reversible-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);

            // V1.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');
            const snapV1 = await io.captureSnapshot(null);

            // V2.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'RR');

            const listBefore = await io.listSnapshots();
            expect(listBefore.length).toBe(1);

            // Restore V1 — must FIRST snapshot the current (V2) state.
            const out = await io.restoreSnapshot(snapV1.seq, 'u-restorer');
            expect(out.ok).toBe(true);

            const listAfter = await io.listSnapshots();
            // One extra snapshot (the pre-restore V2 capture) exists.
            expect(listAfter.length).toBe(listBefore.length + 1);

            // The newest snapshot captured the V2 state ('RR') and is attributed.
            const newest = listAfter[0];
            expect(newest.byUserId).toBe('u-restorer');

            // Now restore THAT pre-restore snapshot → back to RR.
            const back = await io.restoreSnapshot(newest.seq, null);
            expect(back.ok).toBe(true);
            expect(projectResults(io.doc)[FINDING_KEY_A]?.rating).toBe('RR');
        });
    });

    // ── Scenario 5: Unknown seq ────────────────────────────────────────────────
    it('Scenario 5 — restoreSnapshot(unknown) returns { ok: false }, doc unchanged', async () => {
        const inspectionId = 'insp-unknown-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');

            const before: ResultsProjection = projectResults(io.doc);

            const out = await io.restoreSnapshot(9999, null);
            expect(out.ok).toBe(false);

            // Doc unchanged.
            expect(projectResults(io.doc)).toEqual(before);

            // No snapshot was created by the failed restore.
            const list = await io.listSnapshots();
            expect(list.length).toBe(0);
        });
    });

    // ── Scenario 6: connect captures the PRE-MERGE boundary ───────────────────
    // The connect-capture is factored into captureSnapshotOnConnect (driven by
    // the /ws accept path AFTER hydrate, BEFORE acceptWebSocket). We test the
    // helper directly: seed 'NI', take the connect snapshot at 'NI', THEN change
    // to 'RR' — the connect snapshot must still hold the pre-change 'NI' value, so
    // the about-to-be-overwritten value is recoverable.
    it('Scenario 6 — connect captures the pre-merge state (reason:connect)', async () => {
        const inspectionId = 'insp-connect-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);

            // Pre-merge state: rating NI.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');

            // A client reconnects — snapshot taken BEFORE its offline edits merge.
            await io.captureSnapshotOnConnect('u-connector');

            // Now the reconnecting client's buffered edit merges (LWW → RR),
            // which would otherwise silently overwrite NI.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'RR');
            expect(projectResults(io.doc)[FINDING_KEY_A]?.rating).toBe('RR');

            // The connect snapshot preserves the pre-merge NI value.
            const list = await io.listSnapshots();
            const connectSnap = list.find((s) => s.reason === 'connect');
            expect(connectSnap).toBeDefined();
            expect(connectSnap?.byUserId).toBe('u-connector');

            const full = await io.getSnapshot(connectSnap!.seq);
            expect(full?.projection[FINDING_KEY_A]?.rating).toBe('NI');
        });
    });

    // ── Scenario 7: connect-capture dedup (no change → no second snapshot) ────
    it('Scenario 7 — two no-change connects add only ONE snapshot (dedup)', async () => {
        const inspectionId = 'insp-dedup-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');

            // First connect → one snapshot.
            await io.captureSnapshotOnConnect('u1');
            const afterFirst = await io.listSnapshots();
            const connectCountFirst = afterFirst.filter((s) => s.reason === 'connect').length;
            expect(connectCountFirst).toBe(1);

            // Second connect with NO intervening change → deduped (no new snapshot).
            await io.captureSnapshotOnConnect('u2');
            const afterSecond = await io.listSnapshots();
            expect(afterSecond.length).toBe(afterFirst.length);
            expect(afterSecond.filter((s) => s.reason === 'connect').length).toBe(1);

            // A real change THEN reconnect → a new connect snapshot is taken.
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'RR');
            await io.captureSnapshotOnConnect('u3');
            const afterChange = await io.listSnapshots();
            expect(afterChange.filter((s) => s.reason === 'connect').length).toBe(2);
        });
    });

    // ── Scenario 8: reason is surfaced + distinguishes periodic/manual/connect ─
    it('Scenario 8 — listSnapshots surfaces reason for each capture kind', async () => {
        const inspectionId = 'insp-reason-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);

            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');
            const manual = await io.captureSnapshot('u-manual', 'manual');

            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'RR');
            await io.captureSnapshotOnConnect('u-connect');

            applyItemPatch(io.doc, FINDING_KEY_A, 'notes', 'changed');
            const periodic = await io.captureSnapshot(null, 'periodic');

            const list = await io.listSnapshots();
            const bySeq = new Map(list.map((s) => [s.seq, s.reason]));
            expect(bySeq.get(manual.seq)).toBe('manual');
            expect(bySeq.get(periodic.seq)).toBe('periodic');
            expect(list.some((s) => s.reason === 'connect')).toBe(true);
        });
    });

    // ── Scenario 9: get-by-seq returns the full projection / null on unknown ──
    it('Scenario 9 — getSnapshot returns the full projection, null for unknown seq', async () => {
        const inspectionId = 'insp-getbyseq-' + crypto.randomUUID().slice(0, 8);
        await ensureResultsRow(TENANT, inspectionId);

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            setIdentity(io, TENANT, inspectionId);

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY_A }]);
            applyItemPatch(io.doc, FINDING_KEY_A, 'rating', 'NI');
            const snap = await io.captureSnapshot('u-x', 'manual');

            const full = await io.getSnapshot(snap.seq);
            expect(full).not.toBeNull();
            expect(full?.seq).toBe(snap.seq);
            expect(full?.reason).toBe('manual');
            expect(full?.projection[FINDING_KEY_A]?.rating).toBe('NI');

            // Unknown seq → null (the route maps this to 404).
            expect(await io.getSnapshot(9999)).toBeNull();
        });
    });
});
