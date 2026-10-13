/**
 * Resolving pending photo entries after an offline import (workerd).
 *
 * `POST /resolve-pending` on the Durable Object swaps `pendingUpload` photo
 * entries for the R2 keys the offline-bundle service uploaded. Every refusal is
 * paired with a positive control (the same call with a legal map succeeds) so a
 * harness that rejects everything cannot pass.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import { INSPECTION_RESULTS_TEST_DDL } from '../../helpers/inline-ddl';
import { seedResultsDoc, pushPendingPhoto, appendPhoto, projectResults } from '../../../server/lib/collab/results-doc';
import { MAX_PENDING_ENTRIES } from '../../../server/durable-objects/inspection-doc-import';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';

interface TestBindings {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as unknown as TestBindings;

const TENANT = 'test-tenant-resolve';
const KEY = '_default:sec1:item1';
const KEY2 = '_default:sec1:item2';

async function seedSchema(): Promise<void> {
    await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
}

async function clearTables(): Promise<void> {
    await b.DB.exec('DELETE FROM inspection_results;');
    await b.DB.exec('DELETE FROM inspections;');
}

interface DOInternals {
    doc: Y.Doc;
    tenantId: string | null;
    inspectionId: string | null;
    identityPersisted: boolean;
    persist(): Promise<void>;
    ctx: { getWebSockets(): unknown[] };
    fetch(req: Request): Promise<Response>;
}

class MockWebSocket {
    readonly sent: Uint8Array[] = [];
    send(data: ArrayBuffer | Uint8Array | string): void {
        if (typeof data === 'string') return;
        this.sent.push(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    }
    close(): void { /* no-op */ }
}

function pendingPhoto(pendingId: string): PhotoEntry & { pendingId: string } {
    return { key: '', pendingUpload: true, pendingId, pendingKind: 'photo', mediaId: `m-${pendingId}` };
}

interface Fixture {
    inspectionId: string;
    stub: DurableObjectStub<InspectionDocDO>;
    prefix: string;
}

/** A document with pending photos A and B on one item, C on another, and one already-uploaded photo. */
async function seededServer(): Promise<Fixture> {
    const inspectionId = 'insp-resolve-' + crypto.randomUUID().slice(0, 8);
    const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));
    await runInDurableObject(stub, (instance: InspectionDocDO) => {
        const io = instance as unknown as DOInternals;
        io.tenantId = TENANT;
        io.inspectionId = inspectionId;
        io.identityPersisted = true;
        seedResultsDoc(io.doc, [{ findingKey: KEY }, { findingKey: KEY2 }]);
        appendPhoto(io.doc, KEY, { key: 'already/uploaded.jpg' });
        pushPendingPhoto(io.doc, KEY, pendingPhoto('A'));
        pushPendingPhoto(io.doc, KEY, pendingPhoto('B'));
        pushPendingPhoto(io.doc, KEY2, pendingPhoto('C'));
    });
    return { inspectionId, stub, prefix: `${TENANT}/inspections/${inspectionId}/photos/` };
}

function resolveRequest(f: Fixture, body: unknown): Request {
    return new Request('https://do.local/resolve-pending', {
        method: 'POST',
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': f.inspectionId, 'x-user-id': 'u-importer' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

async function photosOf(f: Fixture, findingKey: string): Promise<PhotoEntry[]> {
    return runInDurableObject(f.stub, (instance: InspectionDocDO) => {
        const item = projectResults((instance as unknown as DOInternals).doc)[findingKey];
        return (item?.photos as PhotoEntry[] | undefined) ?? [];
    });
}

async function liveState(f: Fixture): Promise<Uint8Array> {
    return runInDurableObject(f.stub, (instance: InspectionDocDO) =>
        Y.encodeStateAsUpdate((instance as unknown as DOInternals).doc));
}

async function snapshotCount(f: Fixture): Promise<number> {
    const res = await f.stub.fetch('https://do.local/snapshots', {
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': f.inspectionId },
    });
    return ((await res.json()) as unknown[]).length;
}

describe('DO /resolve-pending', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('resolves only the listed pending entries, then the rest on a later call, keeping order and other fields', async () => {
        const f = await seededServer();

        const first = await f.stub.fetch(resolveRequest(f, { A: `${f.prefix}A.jpg` }));
        expect(first.status, await first.clone().text()).toBe(200);
        expect(await first.json()).toEqual({ ok: true, matched: 1, unmatched: 0, changed: true });

        let photos = await photosOf(f, KEY);
        expect(photos.map((p) => p.key)).toEqual(['already/uploaded.jpg', `${f.prefix}A.jpg`, '']);
        expect(photos[1]).toMatchObject({ mediaId: 'm-A' });
        expect(photos[1].pendingUpload).toBeUndefined();
        expect(photos[1].pendingId).toBeUndefined();
        expect(photos[1].pendingKind).toBeUndefined();
        // B is still pending: the replacement is addressed by id, not by position.
        expect(photos[2]).toMatchObject({ pendingId: 'B', pendingUpload: true });
        expect((await photosOf(f, KEY2))[0]).toMatchObject({ pendingId: 'C', pendingUpload: true });

        const second = await f.stub.fetch(resolveRequest(f, { B: `${f.prefix}B.jpg`, C: `${f.prefix}C.jpg` }));
        expect(await second.json()).toEqual({ ok: true, matched: 2, unmatched: 0, changed: true });
        photos = await photosOf(f, KEY);
        expect(photos.map((p) => p.key)).toEqual(['already/uploaded.jpg', `${f.prefix}A.jpg`, `${f.prefix}B.jpg`]);
        expect(photos.every((p) => p.pendingUpload === undefined)).toBe(true);
        expect((await photosOf(f, KEY2))[0].key).toBe(`${f.prefix}C.jpg`);
    });

    it('a repeat of the same map changes nothing, takes no snapshot, and leaves the bytes alone', async () => {
        const f = await seededServer();
        const map = { A: `${f.prefix}A.jpg`, B: `${f.prefix}B.jpg` };
        expect((await f.stub.fetch(resolveRequest(f, map))).status).toBe(200);
        const stateAfterFirst = await liveState(f);
        const snapshots = await snapshotCount(f);
        // The swap itself is never snapshotted: it is replayable from the map.
        expect(snapshots).toBe(0);

        const again = await f.stub.fetch(resolveRequest(f, map));
        expect(again.status).toBe(200);
        expect(await again.json()).toEqual({ ok: true, matched: 0, unmatched: 2, changed: false });
        expect(await liveState(f)).toEqual(stateAfterFirst);
        expect(await snapshotCount(f)).toBe(snapshots);

        // Control: a map that still has something to resolve does change the bytes.
        const third = await f.stub.fetch(resolveRequest(f, { C: `${f.prefix}C.jpg` }));
        expect(((await third.json()) as { changed: boolean }).changed).toBe(true);
        expect(await liveState(f)).not.toEqual(stateAfterFirst);
    });

    it('counts an id with no pending entry as unmatched and leaves the document alone', async () => {
        const f = await seededServer();
        const before = await liveState(f);
        const res = await f.stub.fetch(resolveRequest(f, { Z: `${f.prefix}Z.jpg` }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, matched: 0, unmatched: 1, changed: false });
        expect(await liveState(f)).toEqual(before);

        // Control: mixing a real id in resolves it and still counts the stranger.
        const mixed = await f.stub.fetch(resolveRequest(f, { Z: `${f.prefix}Z.jpg`, A: `${f.prefix}A.jpg` }));
        expect(await mixed.json()).toEqual({ ok: true, matched: 1, unmatched: 1, changed: true });
    });

    it('does not touch an entry that is not pendingUpload, even when its pendingId is listed', async () => {
        const f = await seededServer();
        await runInDurableObject(f.stub, (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            // A crop derivative: base key kept, pendingId set, pendingUpload NOT set.
            appendPhoto(io.doc, KEY2, { key: 'base/photo.jpg', pendingId: 'D', pendingKind: 'crop' });
        });
        const res = await f.stub.fetch(resolveRequest(f, { D: `${f.prefix}D.jpg` }));
        expect(await res.json()).toEqual({ ok: true, matched: 0, unmatched: 1, changed: false });
        expect((await photosOf(f, KEY2)).find((p) => p.pendingId === 'D')?.key).toBe('base/photo.jpg');
    });

    it('answers 400 for a key outside this tenant or this inspection, and the document is untouched; the legal key succeeds', async () => {
        const f = await seededServer();
        const before = await liveState(f);
        const foreign = `other-tenant/inspections/${f.inspectionId}/photos/A.jpg`;
        const bad = [
            foreign,
            `${TENANT}/inspections/some-other-inspection/photos/A.jpg`,
            `${TENANT}/inspections/${f.inspectionId}-x/photos/A.jpg`,
            `${TENANT}/inspections/${f.inspectionId}/photos/../../x.jpg`,
            `${TENANT}/inspections/${f.inspectionId}/videos/A.mp4`,
            f.prefix,
            '_platform/statutory-forms/x.pdf',
        ];
        for (const key of bad) {
            const res = await f.stub.fetch(resolveRequest(f, { A: key }));
            expect(res.status, key).toBe(400);
            expect(((await res.json()) as { reason: string }).reason).toBe('invalid_key');
        }
        const nonString = await f.stub.fetch(resolveRequest(f, { A: 7 }));
        expect(nonString.status).toBe(400);
        // A map with one good pair and one bad pair is refused whole.
        const partial = await f.stub.fetch(resolveRequest(f, { A: `${f.prefix}A.jpg`, B: foreign }));
        expect(partial.status).toBe(400);
        expect(await liveState(f)).toEqual(before);

        const ok = await f.stub.fetch(resolveRequest(f, { A: `${f.prefix}A.jpg` }));
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('answers 400 for a pendingId with illegal characters or length; legal ids succeed', async () => {
        const f = await seededServer();
        const before = await liveState(f);
        for (const id of ['a b', 'a/b', 'a.b', '', 'x'.repeat(65), 'é']) {
            const res = await f.stub.fetch(resolveRequest(f, { [id]: `${f.prefix}A.jpg` }));
            expect(res.status, JSON.stringify(id)).toBe(400);
            expect(((await res.json()) as { reason: string }).reason).toBe('invalid_pending_id');
        }
        expect(await liveState(f)).toEqual(before);
        const edge = await f.stub.fetch(resolveRequest(f, { ['x'.repeat(64)]: `${f.prefix}A.jpg`, 'a_b-1': `${f.prefix}B.jpg` }));
        expect(edge.status).toBe(200);
    });

    it('answers 400 for a body that is not a JSON object', async () => {
        const f = await seededServer();
        for (const body of ['not json', '[]', 'null', '"A"', '']) {
            const res = await f.stub.fetch(resolveRequest(f, body));
            expect(res.status, body).toBe(400);
        }
        expect((await f.stub.fetch(resolveRequest(f, {}))).status).toBe(200);
    });

    it('answers 413 above the entry limit; exactly the limit is accepted', async () => {
        const f = await seededServer();
        const make = (n: number): Record<string, string> => {
            const m: Record<string, string> = {};
            for (let i = 0; i < n; i++) m[`p${i}`] = `${f.prefix}p${i}.jpg`;
            return m;
        };
        const before = await liveState(f);
        const over = await f.stub.fetch(resolveRequest(f, make(MAX_PENDING_ENTRIES + 1)));
        expect(over.status).toBe(413);
        expect(await liveState(f)).toEqual(before);

        const atLimit = await f.stub.fetch(resolveRequest(f, make(MAX_PENDING_ENTRIES)));
        expect(atLimit.status, await atLimit.clone().text()).toBe(200);
    });

    it('answers 413 above the body size limit before parsing it', async () => {
        const f = await seededServer();
        const res = await f.stub.fetch(resolveRequest(f, ' '.repeat(600 * 1024) + '{}'));
        expect(res.status).toBe(413);
        expect((await f.stub.fetch(resolveRequest(f, {}))).status).toBe(200);
    });

    it('answers 400 when the route supplied no identity', async () => {
        const fresh = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:anonymous-${crypto.randomUUID().slice(0, 8)}`));
        const res = await fresh.fetch('https://do.local/resolve-pending', { method: 'POST', body: '{}' });
        expect(res.status).toBe(400);
    });

    it('answers 503 when persisting fails, and a retry reports no change', async () => {
        const f = await seededServer();
        const map = { A: `${f.prefix}A.jpg` };
        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            const realPersist = io.persist.bind(io);
            io.persist = () => Promise.reject(new Error('d1 unavailable'));
            try {
                expect((await io.fetch(resolveRequest(f, map))).status).toBe(503);
            } finally {
                io.persist = realPersist;
            }
            const retry = await io.fetch(resolveRequest(f, map));
            expect(retry.status).toBe(200);
            expect(await retry.json()).toEqual({ ok: true, matched: 0, unmatched: 1, changed: false });
        });
    });

    it('broadcasts the swap to a connected editor', async () => {
        const f = await seededServer();
        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            const editor = new MockWebSocket();
            io.ctx.getWebSockets = () => [editor];

            // Control: a call that resolves nothing broadcasts nothing.
            await io.fetch(resolveRequest(f, { Z: `${f.prefix}Z.jpg` }));
            expect(editor.sent).toHaveLength(0);

            const res = await io.fetch(resolveRequest(f, { A: `${f.prefix}A.jpg` }));
            expect(res.status).toBe(200);
            const frames = editor.sent.filter((fr) => {
                const d = decoding.createDecoder(fr);
                return decoding.readVarUint(d) === 0 && decoding.readVarUint(d) === syncProtocol.messageYjsUpdate;
            });
            expect(frames).toHaveLength(1);
        });
    });
});
