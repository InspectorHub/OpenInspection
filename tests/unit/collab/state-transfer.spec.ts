import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
    bytesToBase64, importState, parseStateImport, handleStateTransfer,
    type ImportedSnapshot, type StateKeys, type StateImportBody, type TransferStorage, type StoredValue, type TransferHost,
} from '../../../server/durable-objects/inspection-doc-state-transfer';
import {
    appendPhoto, applyItemPatch, loadResultsProjection, projectResults, removeFindingKeys, seedResultsDoc,
} from '../../../packages/field-ui/src/shared/results-doc';

const KEYS: StateKeys = { ydoc: 'ydoc', identity: 'identity', snapshots: 'snapshots', derived: 'derived-from-d1', backup: 'replaced-derived-backup' };
const IDENTITY = { tenantId: 't-1', inspectionId: 'i-1', reportId: 'r-1' };
const SNAP: ImportedSnapshot = { seq: 1, atMs: 1700000000000, byUserId: 'u-1', reason: 'manual', projection: { marker: 'x' } };

function resultsBytes(): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap('results').set('item', 'cracked flashing');
    return Y.encodeStateAsUpdate(doc);
}

function resultsBytesOther(): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap('results').set('item', 'different content');
    return Y.encodeStateAsUpdate(doc);
}

function body(over: Partial<StateImportBody> = {}): StateImportBody {
    return { ydoc: bytesToBase64(resultsBytes()), identity: IDENTITY, snapshots: [], ...over };
}

/** What the object receives is JSON from a caller, so the wrong shapes below are built the way they would arrive: as text. */
function wire(over: object): StateImportBody {
    return JSON.parse(JSON.stringify({ ...body(), ...over }));
}

interface FakeStorage extends TransferStorage { data: Map<string, StoredValue>; putCalls: Array<Record<string, StoredValue>> }
function fakeStorage(initial: Record<string, StoredValue> = {}): FakeStorage {
    const data = new Map(Object.entries(initial));
    const putCalls: Array<Record<string, StoredValue>> = [];
    return {
        data, putCalls,
        get: async (keys) => new Map(keys.flatMap((k) => (data.has(k) ? [[k, data.get(k) as StoredValue] as const] : []))),
        put: async (entries) => { putCalls.push(entries); for (const [k, v] of Object.entries(entries)) data.set(k, v); },
    };
}

describe('parseStateImport: the document is validated before anything can be written', () => {
    it('accepts a real results document', () => {
        expect(parseStateImport(body())?.identity).toEqual(IDENTITY);
    });
    it('rejects text that is not base64', () => {
        expect(parseStateImport(body({ ydoc: '%%% not base64 %%%' }))).toBeNull();
    });
    it('rejects bytes that are not a Yjs update', () => {
        expect(parseStateImport(body({ ydoc: bytesToBase64(new Uint8Array([255, 255, 255, 9, 9, 9, 9, 9])) }))).toBeNull();
    });
    it('rejects a document whose top-level shape is not the results map', () => {
        const other = new Y.Doc();
        other.getMap('somethingElse').set('x', 1);
        expect(parseStateImport(body({ ydoc: bytesToBase64(Y.encodeStateAsUpdate(other)) }))).toBeNull();
        const wrongType = new Y.Doc();
        wrongType.getArray('results').push([1]);
        expect(parseStateImport(body({ ydoc: bytesToBase64(Y.encodeStateAsUpdate(wrongType)) }))).toBeNull();
    });
});

describe('parseStateImport: restore points must have the shape the object writes', () => {
    const accepts = (snapshots: object) => parseStateImport(wire({ snapshots })) !== null;
    it('accepts a well-formed restore point, with or without a reason, and a null author', () => {
        expect(accepts([SNAP])).toBe(true);
        expect(accepts([{ seq: 2, atMs: 5, byUserId: null, projection: {} }])).toBe(true);
    });
    it('rejects an entry missing a required field or with the wrong type', () => {
        expect(accepts([{ seq: 1 }])).toBe(false);
        expect(accepts([{ ...SNAP, seq: 'one' }])).toBe(false);
        expect(accepts([{ ...SNAP, atMs: null }])).toBe(false);
        expect(accepts([{ ...SNAP, byUserId: 7 }])).toBe(false);
        expect(accepts([{ ...SNAP, reason: 'invented' }])).toBe(false);
        expect(accepts([{ ...SNAP, projection: null }])).toBe(false);
        expect(accepts([{ ...SNAP, projection: [] }])).toBe(false);
        expect(accepts(['text', 4])).toBe(false);
    });
    it('rejects a body that is not an array, more entries than the object ever keeps, and an oversized payload', () => {
        expect(accepts({ seq: 1 })).toBe(false);
        expect(accepts(Array.from({ length: 26 }, (_v, i) => ({ ...SNAP, seq: i })))).toBe(false);
        expect(accepts([{ ...SNAP, projection: { blob: 'x'.repeat(3_000_000) } }])).toBe(false);
    });
});

describe('parseStateImport: documents the real editor builds', () => {
    const KEY_A = 'a:b:c';
    const KEY_B = 'x:y:z';
    const accepts = (bytes: Uint8Array) => parseStateImport(body({ ydoc: bytesToBase64(bytes) })) !== null;

    function built(): Y.Doc {
        const d = new Y.Doc();
        seedResultsDoc(d, [{ findingKey: KEY_A }, { findingKey: KEY_B }]);
        applyItemPatch(d, KEY_A, 'rating', 'defect');
        applyItemPatch(d, KEY_A, 'notes', 'hello');
        appendPhoto(d, KEY_A, { key: 'k1' });
        return d;
    }

    it('accepts a seeded, edited document with a photo', () => {
        expect(accepts(Y.encodeStateAsUpdate(built()))).toBe(true);
    });
    it('accepts it after a finding was removed, and when every finding was removed', () => {
        const d = built();
        removeFindingKeys(d, [KEY_B]);
        expect(accepts(Y.encodeStateAsUpdate(d))).toBe(true);
        removeFindingKeys(d, [KEY_A]);
        expect(accepts(Y.encodeStateAsUpdate(d))).toBe(true);
    });
    it('accepts a document rebuilt from its own projection', () => {
        const fresh = new Y.Doc();
        loadResultsProjection(fresh, projectResults(built()));
        expect(accepts(Y.encodeStateAsUpdate(fresh))).toBe(true);
    });
    it('accepts merged updates', () => {
        expect(accepts(Y.mergeUpdates([Y.encodeStateAsUpdate(built())]))).toBe(true);
    });
    it('rejects a diff-only update, which lacks the structs it builds on', () => {
        const d = built();
        const sv = Y.encodeStateVector(d);
        appendPhoto(d, KEY_A, { key: 'k2' });
        expect(accepts(Y.encodeStateAsUpdate(d, sv))).toBe(false);
    });
});

describe('importState', () => {
    it('writes content, identity and restore points in ONE storage put, so a crash cannot leave part of an import', async () => {
        const s = fakeStorage();
        const out = await importState(s, KEYS, body({ snapshots: [SNAP] }), () => false);
        expect(out.status).toBe('imported');
        expect(s.putCalls).toHaveLength(1);
        expect(Object.keys(s.putCalls[0] ?? {}).sort()).toEqual(['identity', 'snapshots', 'ydoc']);
    });

    it('writes nothing for an invalid document', async () => {
        const s = fakeStorage();
        expect((await importState(s, KEYS, body({ ydoc: bytesToBase64(new Uint8Array([1, 2, 3])) }), () => false)).status).toBe('invalid');
        expect(s.putCalls).toEqual([]);
    });

    it('refuses a target that holds a document, with a reason and its size, and keeps what it had', async () => {
        const existing = resultsBytes();
        const s = fakeStorage({ ydoc: existing });
        const out = await importState(s, KEYS, body(), () => false);
        expect(out).toEqual({ status: 'refused', reason: 'target-has-state', targetBytes: existing.length, targetSnapshots: 0 });
        expect(s.putCalls).toEqual([]);
    });

    it('also refuses a target that has only an identity or only restore points', async () => {
        const cases: Array<Record<string, StoredValue>> = [{ identity: IDENTITY }, { snapshots: [SNAP] }];
        for (const initial of cases) {
            const s = fakeStorage(initial);
            const out = await importState(s, KEYS, body(), () => false);
            expect(out).toMatchObject({ status: 'refused', reason: 'target-has-state' });
            expect(s.putCalls).toEqual([]);
        }
    });

    it('refuses a target whose in-memory document is already live', async () => {
        const s = fakeStorage();
        const out = await importState(s, KEYS, body(), () => true);
        expect(out).toMatchObject({ status: 'refused', reason: 'target-live' });
        expect(s.putCalls).toEqual([]);
    });
});

describe('importState with replaceDerived: only a document built from the database and never edited may be replaced', () => {
    const derivedTarget = (over: Record<string, StoredValue> = {}) =>
        fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, snapshots: [], 'derived-from-d1': true, ...over });
    const replaceBody = body({ replaceDerived: true, snapshots: [SNAP] });

    it('replaces it in one put, clears the marker in that same put, and returns hashes of both sides', async () => {
        const s = derivedTarget();
        const before = s.data.get('ydoc');
        const out = await importState(s, KEYS, replaceBody, () => false);
        expect(out.status).toBe('imported');
        if (out.status !== 'imported') return;
        expect(out.replaced?.previousBytes).toBe(before instanceof Uint8Array ? before.length : -1);
        expect(out.replaced?.previousSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(out.replaced?.newSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(s.putCalls).toHaveLength(1);
        expect(s.putCalls[0]?.['derived-from-d1']).toBe(false);
        expect(s.data.get('snapshots')).toEqual([SNAP]);
    });

    it('is idempotent: once replaced the marker is false, so a second run is refused as edited', async () => {
        const s = derivedTarget();
        await importState(s, KEYS, replaceBody, () => false);
        expect(await importState(s, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-edited' });
        expect(s.putCalls).toHaveLength(1);
    });

    it('never replaces a live target', async () => {
        const s = derivedTarget();
        expect(await importState(s, KEYS, replaceBody, () => true)).toMatchObject({ status: 'refused', reason: 'target-live' });
        expect(s.putCalls).toEqual([]);
    });

    it('never replaces a target that has had client edits, or one with no marker at all', async () => {
        const edited = derivedTarget({ 'derived-from-d1': false });
        expect(await importState(edited, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-edited' });
        expect(edited.putCalls).toEqual([]);
        const none = fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY });
        expect(await importState(none, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-edited' });
        expect(none.putCalls).toEqual([]);
    });

    it('never replaces a target whose stored identity is not the row (or is missing)', async () => {
        for (const identity of [{ ...IDENTITY, reportId: 'r-other' }, { ...IDENTITY, tenantId: 't-other' }]) {
            const s = derivedTarget({ identity });
            expect(await importState(s, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-identity-mismatch' });
            expect(s.putCalls).toEqual([]);
        }
        const noIdentity = fakeStorage({ ydoc: resultsBytes(), 'derived-from-d1': true });
        expect(await importState(noIdentity, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-identity-mismatch' });
    });

    it('keeps the replaced document in a backup key, written in the SAME put as the replacement', async () => {
        const s = derivedTarget();
        const before = s.data.get('ydoc');
        await importState(s, KEYS, replaceBody, () => false);
        expect(s.putCalls).toHaveLength(1);
        const backup = s.data.get('replaced-derived-backup');
        expect(backup).toMatchObject({ ydoc: before, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), atMs: expect.any(Number) });
        expect(s.putCalls[0]).toHaveProperty('replaced-derived-backup');
    });

    it('answers target-unsaved, not target-edited, for a database-built target that was evicted before its first save', async () => {
        const s = fakeStorage({ identity: IDENTITY, 'derived-from-d1': true });
        expect(await importState(s, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-unsaved' });
        expect(s.putCalls).toEqual([]);
    });

    it('decides liveness AFTER the digests: a target that goes live while they are computed is refused', async () => {
        const log: string[] = [];
        const s = derivedTarget();
        const spied: TransferStorage = {
            get: async (keys) => { log.push('get'); return s.get(keys); },
            put: async (entries) => { log.push('put'); return s.put(entries); },
        };
        // Live only from the second storage read on: a check made before the digests would not see it.
        const live = () => { log.push('live'); return log.filter((l) => l === 'get').length >= 2; };
        const out = await importState(spied, KEYS, replaceBody, live);
        expect(out).toMatchObject({ status: 'refused', reason: 'target-live' });
        expect(s.putCalls).toEqual([]);
        expect(log.slice(-2)).toEqual(['get', 'live']);
    });

    it('with nothing live, the last storage read, the liveness check and the put are consecutive', async () => {
        const log: string[] = [];
        const s = derivedTarget();
        const spied: TransferStorage = {
            get: async (keys) => { log.push('get'); return s.get(keys); },
            put: async (entries) => { log.push('put'); return s.put(entries); },
        };
        await importState(spied, KEYS, replaceBody, () => { log.push('live'); return false; });
        expect(log.slice(-3)).toEqual(['get', 'live', 'put']);
    });

    it('refuses when the target document changed while the digests were computed', async () => {
        const s = derivedTarget();
        let reads = 0;
        const changing: TransferStorage = {
            get: async (keys) => { const m = await s.get(keys); if (++reads === 2) m.set('ydoc', resultsBytesOther()); return m; },
            put: s.put,
        };
        expect(await importState(changing, KEYS, replaceBody, () => false)).toMatchObject({ status: 'refused', reason: 'target-live' });
        expect(s.putCalls).toEqual([]);
    });

    it('without the flag a derived target is still a plain refusal', async () => {
        const s = derivedTarget();
        expect(await importState(s, KEYS, body(), () => false)).toMatchObject({ status: 'refused', reason: 'target-has-state' });
    });
});

describe('handleStateTransfer', () => {
    function host(storage: TransferStorage): TransferHost & { adopted: number; flushed: number } {
        const h = {
            adopted: 0, flushed: 0, storage, keys: KEYS,
            live: () => false,
            flush: async () => { h.flushed++; },
            adopt: () => { h.adopted++; },
        };
        return h;
    }
    const post = (path: string, payload: StateImportBody) => new Request(`https://do.test/${path}`, { method: 'POST', body: JSON.stringify(payload) });

    it('returns null for a path that is not a transfer verb', async () => {
        expect(await handleStateTransfer(new Request('https://do.test/ws'), '/ws', host(fakeStorage()))).toBeNull();
    });

    it('exports with the marker, after flushing what sockets sent', async () => {
        const h = host(fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, 'derived-from-d1': true }));
        const res = await handleStateTransfer(new Request('https://do.test/state-export'), '/state-export', h);
        expect(h.flushed).toBe(1);
        expect(await res?.json()).toMatchObject({ identity: IDENTITY, derivedFromD1: true });
    });

    it('restores the backup of a replaced target: the document comes back, the marker is set again, and the backup is spent', async () => {
        const s = fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, 'derived-from-d1': true });
        const original = s.data.get('ydoc');
        const h = host(s);
        await handleStateTransfer(post('state-import', body({ replaceDerived: true })), '/state-import', h);
        expect(s.data.get('ydoc')).not.toEqual(original);
        const res = await handleStateTransfer(new Request('https://do.test/state-restore-backup', { method: 'POST' }), '/state-restore-backup', h);
        expect(res?.status).toBe(200);
        expect(s.data.get('ydoc')).toEqual(original);
        expect(s.data.get('derived-from-d1')).toBe(true);
        expect(h.adopted).toBe(2);
        const again = await handleStateTransfer(new Request('https://do.test/state-restore-backup', { method: 'POST' }), '/state-restore-backup', h);
        expect(again?.status).toBe(404);
    });

    it('refuses to restore into a live object, and answers 404 when there is no backup', async () => {
        const s = fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, 'derived-from-d1': true });
        const h = host(s);
        const none = await handleStateTransfer(new Request('https://do.test/state-restore-backup', { method: 'POST' }), '/state-restore-backup', h);
        expect(none?.status).toBe(404);
        await handleStateTransfer(post('state-import', body({ replaceDerived: true })), '/state-import', h);
        const liveHost = { ...h, live: () => true };
        const res = await handleStateTransfer(new Request('https://do.test/state-restore-backup', { method: 'POST' }), '/state-restore-backup', liveHost);
        expect(res?.status).toBe(409);
    });

    it('refuses to restore once a client has edited the replacement, and changes nothing', async () => {
        const s = fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, 'derived-from-d1': true });
        const h = host(s);
        await handleStateTransfer(post('state-import', body({ replaceDerived: true })), '/state-import', h);
        // A client edits the replacement; the edit persists and the client disconnects, so the object is no longer live.
        const edited = resultsBytesOther();
        s.data.set('ydoc', edited);
        const adoptedBefore = h.adopted;
        const res = await handleStateTransfer(new Request('https://do.test/state-restore-backup', { method: 'POST' }), '/state-restore-backup', h);
        expect(res?.status).toBe(409);
        expect(await res?.json()).toMatchObject({ error: 'target-edited' });
        expect(s.data.get('ydoc')).toEqual(edited);
        expect(s.data.get('derived-from-d1')).toBe(false);
        expect(s.data.get('replaced-derived-backup')).toMatchObject({ sha256: expect.any(String) });
        expect(h.adopted).toBe(adoptedBefore);
    });

    it('the backup records the replacement digest too, and can be read back (with the document) without changing anything', async () => {
        const s = fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, 'derived-from-d1': true });
        const h = host(s);
        const none = await handleStateTransfer(new Request('https://do.test/state-backup'), '/state-backup', h);
        expect(none?.status).toBe(404);
        await handleStateTransfer(post('state-import', body({ replaceDerived: true })), '/state-import', h);
        expect(s.data.get('replaced-derived-backup')).toMatchObject({ newSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
        const putsBefore = s.putCalls.length;
        const res = await handleStateTransfer(new Request('https://do.test/state-backup'), '/state-backup', h);
        expect(res?.status).toBe(200);
        expect(await res?.json()).toMatchObject({ ydoc: expect.any(String), sha256: expect.any(String), newSha256: expect.any(String), atMs: expect.any(Number) });
        expect(s.putCalls.length).toBe(putsBefore);
    });

    it('answers 400, 409 with a reason, or 200 and adopts the document into memory', async () => {
        const h = host(fakeStorage());
        expect((await handleStateTransfer(post('state-import', {}), '/state-import', h))?.status).toBe(400);
        const ok = await handleStateTransfer(post('state-import', body()), '/state-import', h);
        expect(ok?.status).toBe(200);
        expect(h.adopted).toBe(1);
        const again = await handleStateTransfer(post('state-import', body()), '/state-import', h);
        expect(again?.status).toBe(409);
        expect(await again?.json()).toMatchObject({ error: 'target-not-empty', reason: 'target-has-state' });
        expect(h.adopted).toBe(1);
    });
});
