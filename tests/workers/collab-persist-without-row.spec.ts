/**
 * The collab document must land in D1 even when no `inspection_results` row
 * exists yet.
 *
 * persist() UPDATEs that row. An UPDATE that matches nothing is not an error —
 * it silently affects zero rows — and `createInspection` never inserts the row,
 * so for any inspection made through the New Inspection wizard every flush was a
 * no-op. The editor looked perfectly healthy the whole time: the socket said
 * "Connected", the rating pills filled in, the Issues counter moved. All of it
 * lived in the browser's IndexedDB and the DO's own storage; D1 held nothing,
 * and a published report carried no ratings at all.
 *
 * The existing suites never caught it because their helper is called
 * `ensureResultsRow` — the tests create the row first, so they assert the happy
 * path of a precondition production does not guarantee. This spec is the one
 * that does NOT create it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { seedResultsDoc, applyItemPatch } from '../../server/lib/collab/results-doc';

const b = env as unknown as {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
};

const TENANT = 'tenant-persist-no-row';
const FINDING_KEY = '_default:sec1:item1';
const MSG_SYNC = 0;

interface DOInternals {
    doc: Y.Doc;
    tenantId: string | null;
    inspectionId: string | null;
    identityPersisted: boolean;
    persist(): Promise<void>;
    webSocketMessage(ws: WebSocket, data: ArrayBuffer): Promise<void>;
}

async function seedSchema(): Promise<void> {
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspection_results (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, inspection_id TEXT NOT NULL, data TEXT NOT NULL, ydoc_state BLOB, last_synced_at INTEGER NOT NULL, rating_system_id TEXT, rating_system_snapshot TEXT);');
}

async function clearResults(): Promise<void> {
    await b.DB.exec('DELETE FROM inspection_results;');
}

function encodeUpdate(update: Uint8Array): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc);
}

async function readRow(inspectionId: string) {
    return b.DB
        .prepare('SELECT data, ydoc_state FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?')
        .bind(TENANT, inspectionId)
        .first<{ data: string; ydoc_state: ArrayBuffer | null }>();
}

describe('collab persistence with no pre-existing inspection_results row', () => {
    beforeAll(seedSchema);
    beforeEach(clearResults);

    it('creates the row and stores the projection instead of silently dropping the edit', async () => {
        const inspectionId = 'insp-no-row-' + crypto.randomUUID().slice(0, 8);
        // Deliberately NOT calling any ensureResultsRow helper: this is the state
        // an inspection is in right after the New Inspection wizard creates it.
        expect(await readRow(inspectionId)).toBeNull();

        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));
        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            io.tenantId = TENANT;
            io.inspectionId = inspectionId;
            io.identityPersisted = true;

            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY }]);

            const client = new Y.Doc();
            Y.applyUpdate(client, Y.encodeStateAsUpdate(io.doc));
            applyItemPatch(client, FINDING_KEY, 'rating', 'Defect');
            await io.webSocketMessage(
                {} as WebSocket,
                encodeUpdate(Y.encodeStateAsUpdate(client)).buffer as ArrayBuffer,
            );

            await io.persist();
        });

        const row = await readRow(inspectionId);
        expect(row, 'persist() must create the row it writes to').not.toBeNull();
        const data = JSON.parse(row!.data) as Record<string, { rating?: string }>;
        expect(data[FINDING_KEY]?.rating).toBe('Defect');
        // The binary doc state travels too, so a later hydrate resumes cleanly.
        expect(row!.ydoc_state).toBeTruthy();
    });

    it('keeps updating the same row on later flushes rather than inserting twice', async () => {
        const inspectionId = 'insp-no-row-twice-' + crypto.randomUUID().slice(0, 8);
        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));

        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            io.tenantId = TENANT;
            io.inspectionId = inspectionId;
            io.identityPersisted = true;
            seedResultsDoc(io.doc, [{ findingKey: FINDING_KEY }]);

            const client = new Y.Doc();
            Y.applyUpdate(client, Y.encodeStateAsUpdate(io.doc));
            applyItemPatch(client, FINDING_KEY, 'rating', 'Monitor');
            await io.webSocketMessage({} as WebSocket, encodeUpdate(Y.encodeStateAsUpdate(client)).buffer as ArrayBuffer);
            await io.persist();

            applyItemPatch(client, FINDING_KEY, 'rating', 'Satisfactory');
            await io.webSocketMessage({} as WebSocket, encodeUpdate(Y.encodeStateAsUpdate(client)).buffer as ArrayBuffer);
            await io.persist();
        });

        const count = await b.DB
            .prepare('SELECT COUNT(*) AS n FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?')
            .bind(TENANT, inspectionId)
            .first<{ n: number }>();
        expect(count?.n).toBe(1);

        const row = await readRow(inspectionId);
        const data = JSON.parse(row!.data) as Record<string, { rating?: string }>;
        expect(data[FINDING_KEY]?.rating).toBe('Satisfactory');
    });
});
