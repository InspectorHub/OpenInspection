/**
 * The lineage generation travels WITH the document bytes when a results document is copied between objects
 * (see `server/durable-objects/inspection-doc-generation.ts`). A client holding the source's history must stay valid after the
 * copy, a client holding the displaced (database-built) history must not, and a backup restore puts the displaced id back.
 */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
    bytesToBase64, exportStoredState, handleStateTransfer, importState, parseStateImport,
    type StateImportBody, type StoredValue, type TransferHost, type TransferStorage, type ParsedStateImport,
} from '../../../server/durable-objects/inspection-doc-state-transfer';
import { isGeneration } from '../../../server/durable-objects/inspection-doc-generation';
import { migrateCollabDocs } from '../../../server/lib/collab/do-jurisdiction-migrate';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { logger } from '../../../server/lib/logger';
import { KEYS, docBytes, fakeNamespace, identity, stored } from '../helpers/fake-collab-namespace';

const IDENTITY = { tenantId: 't-1', inspectionId: 'i-1', reportId: 'r-1' };
const SOURCE_GEN = 'source-gen-0001';
const TARGET_GEN = 'target-gen-0002';

function resultsBytes(marker = 'cracked flashing'): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap('results').set('item', marker);
    return Y.encodeStateAsUpdate(doc);
}
function body(over: Partial<StateImportBody> = {}): StateImportBody {
    return { ydoc: bytesToBase64(resultsBytes()), identity: IDENTITY, snapshots: [], ...over };
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
const derivedTarget = (over: Record<string, StoredValue> = {}) =>
    fakeStorage({ ydoc: resultsBytes('built from the database'), identity: IDENTITY, snapshots: [], 'derived-from-d1': true, gen: TARGET_GEN, ...over });

describe('parseStateImport: the generation is validated like the rest of the body', () => {
    it('keeps a well-formed generation', () => {
        expect(parseStateImport(body({ gen: SOURCE_GEN }))?.gen).toBe(SOURCE_GEN);
    });
    it.each([
        ['a number', 12345678],
        ['too short', 'abc'],
        ['too long', 'g'.repeat(65)],
        ['unsafe characters', 'gen with spaces!'],
        ['markup', '<script>alert(1)</script>'],
        ['an object', { x: 1 }],
        ['empty', ''],
    ])('rejects a generation that is %s', (_label, gen) => {
        expect(parseStateImport(JSON.parse(JSON.stringify({ ...body(), gen })))).toBeNull();
    });
    it('mints a new valid generation for an export from an older object that carried none', () => {
        const a = parseStateImport(body());
        const b = parseStateImport(body());
        expect(isGeneration(a?.gen)).toBe(true);
        expect(a?.gen).not.toBe(b?.gen);
    });
});

describe('export carries the generation', () => {
    it('exports the stored generation, and null when none was stored', async () => {
        expect((await exportStoredState(fakeStorage({ ydoc: resultsBytes(), gen: SOURCE_GEN }), KEYS)).gen).toBe(SOURCE_GEN);
        expect((await exportStoredState(fakeStorage({ ydoc: resultsBytes() }), KEYS)).gen).toBeNull();
    });
});

describe('import carries the generation', () => {
    it('a plain import into an empty target adopts the source generation, in the same put as the document', async () => {
        const s = fakeStorage();
        const out = await importState(s, KEYS, body({ gen: SOURCE_GEN }), () => false);
        expect(out.status).toBe('imported');
        expect(s.putCalls).toHaveLength(1);
        expect(s.putCalls[0]?.gen).toBe(SOURCE_GEN);
        expect(s.data.get('gen')).toBe(SOURCE_GEN);
    });

    it('a plain import without a generation mints a new one (never reuses the target one)', async () => {
        const s = fakeStorage({ gen: TARGET_GEN });
        await importState(s, KEYS, body(), () => false);
        const gen = s.data.get('gen');
        expect(typeof gen === 'string' && isGeneration(gen)).toBe(true);
        expect(gen).not.toBe(TARGET_GEN);
    });

    it('replaceDerived keeps the SOURCE generation, so source clients stay valid and derived-target clients are discarded', async () => {
        const s = derivedTarget();
        const out = await importState(s, KEYS, body({ gen: SOURCE_GEN, replaceDerived: true }), () => false);
        expect(out.status).toBe('imported');
        expect(s.data.get('gen')).toBe(SOURCE_GEN);
        expect(s.data.get('gen')).not.toBe(TARGET_GEN);
        expect(s.putCalls).toHaveLength(1);
    });

    it('replaceDerived records the displaced document generation in the backup', async () => {
        const s = derivedTarget();
        await importState(s, KEYS, body({ gen: SOURCE_GEN, replaceDerived: true }), () => false);
        expect(s.data.get('replaced-derived-backup')).toMatchObject({ gen: TARGET_GEN });
    });

    it('replaceDerived of a legacy target that had no generation stored still replaces and records no backup generation', async () => {
        const s = derivedTarget();
        s.data.delete('gen');
        await importState(s, KEYS, body({ gen: SOURCE_GEN, replaceDerived: true }), () => false);
        const backup = s.data.get('replaced-derived-backup');
        expect(backup && typeof backup === 'object' && 'gen' in backup ? backup.gen : undefined).toBeUndefined();
        expect(s.data.get('gen')).toBe(SOURCE_GEN);
    });
});

describe('/state-restore-backup puts the displaced generation back', () => {
    function host(storage: TransferStorage): TransferHost & { adopted: ParsedStateImport[] } {
        const h = {
            adopted: [] as ParsedStateImport[], storage, keys: KEYS,
            live: () => false,
            flush: async () => undefined,
            adopt: (imported: ParsedStateImport) => { h.adopted.push(imported); },
        };
        return h;
    }
    const post = (path: string, payload: StateImportBody) => new Request(`https://do.test/${path}`, { method: 'POST', body: JSON.stringify(payload) });
    const restore = () => new Request('https://do.test/state-restore-backup', { method: 'POST' });

    it('restores the displaced generation in the same put as the displaced document, and hands it to the live object', async () => {
        const s = derivedTarget();
        const h = host(s);
        await handleStateTransfer(post('state-import', body({ gen: SOURCE_GEN, replaceDerived: true })), '/state-import', h);
        expect(s.data.get('gen')).toBe(SOURCE_GEN);
        const res = await handleStateTransfer(restore(), '/state-restore-backup', h);
        expect(res?.status).toBe(200);
        expect(s.data.get('gen')).toBe(TARGET_GEN);
        expect(s.putCalls.at(-1)).toMatchObject({ gen: TARGET_GEN });
        expect(h.adopted.at(-1)?.gen).toBe(TARGET_GEN);
    });

    it('a backup written before generations existed restores with a freshly minted one (never the replacement one)', async () => {
        const s = derivedTarget();
        s.data.delete('gen');
        const h = host(s);
        await handleStateTransfer(post('state-import', body({ gen: SOURCE_GEN, replaceDerived: true })), '/state-import', h);
        await handleStateTransfer(restore(), '/state-restore-backup', h);
        const gen = s.data.get('gen');
        expect(typeof gen === 'string' && isGeneration(gen)).toBe(true);
        expect(gen).not.toBe(SOURCE_GEN);
    });

    it('export through the verb returns the generation', async () => {
        const h = host(fakeStorage({ ydoc: resultsBytes(), identity: IDENTITY, gen: SOURCE_GEN }));
        const res = await handleStateTransfer(new Request('https://do.test/state-export'), '/state-export', h);
        expect((await res?.json<{ gen: string }>())?.gen).toBe(SOURCE_GEN);
    });
});

describe('the jurisdiction migration forwards the source generation', () => {
    const N1 = collabDocName('t1', 'r1');
    const ref = { rowId: 'row-1', tenantId: 't1', inspectionId: 'i1', reportId: 'r1' };

    it('copies the source generation to an empty pinned target', async () => {
        const from = fakeNamespace({ [N1]: { ...stored(docBytes('A')), gen: SOURCE_GEN } });
        const to = fakeNamespace({});
        await migrateCollabDocs([ref], from, to, { dryRun: false, databaseBlob: () => null });
        expect(to.stores.get(N1)?.get('gen')).toBe(SOURCE_GEN);
    });

    it('replaceDerived leaves the pinned target on the source generation, not the one it built itself', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const from = fakeNamespace({ [N1]: { ...stored(docBytes('A')), gen: SOURCE_GEN } });
        const to = fakeNamespace({ [N1]: { ...stored(docBytes('built'), identity(), true), gen: TARGET_GEN } });
        const out = await migrateCollabDocs([ref], from, to, { dryRun: false, replaceDerived: true, databaseBlob: () => null });
        expect(out.replaced).toBe(1);
        expect(to.stores.get(N1)?.get('gen')).toBe(SOURCE_GEN);
    });
});
