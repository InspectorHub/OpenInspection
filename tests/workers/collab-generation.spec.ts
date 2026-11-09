/**
 * The lineage generation of the results document (workerd). See `server/durable-objects/inspection-doc-generation.ts`.
 *
 * The object keeps a random id naming the history it holds: created with the document, kept through hibernation, minted again
 * when the document is rebuilt (a version restore), unchanged by a same-history change (restructure), and announced as the
 * FIRST frame of every socket, before the sync handshake.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { projectResults, seedResultsDoc } from '@core/field-ui/shared/results-doc';
import * as Y from 'yjs';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { CLOSE_STALE_LINEAGE, GEN_HEADER, isGeneration } from '../../server/durable-objects/inspection-doc-generation';
import type { StateExport } from '../../server/durable-objects/inspection-doc-state-transfer';

interface TestBindings {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as typeof env & TestBindings;

const TENANT = 't-gen';
const INSPECTION = 'i-gen';
const REPORT = 'r-gen';
const KEY = '_default:s1:item1';
const HEADERS = { 'x-tenant-id': TENANT, 'x-inspection-id': INSPECTION, 'x-report-id': REPORT, 'content-type': 'application/json' };
const MSG_SYNC = 0;
const MSG_RESTORE = 2;
const MSG_GENERATION = 4;

let counter = 0;
const freshName = () => `${TENANT}:${REPORT}:${++counter}`;
const stub = (name: string) => b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));

interface DOInternals {
    doc: Y.Doc;
    hydrate(): Promise<void>;
    persist(): Promise<void>;
    ctx: { storage: DurableObjectStorage };
}

async function seedDatabase(): Promise<void> {
    await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
    await b.DB.exec('DELETE FROM inspection_results;');
    await b.DB.exec('DELETE FROM inspections;');
    await b.DB.prepare('INSERT INTO inspections (id, tenant_id, template_snapshot) VALUES (?, ?, ?)').bind(INSPECTION, TENANT, null).run();
    const seed = new Y.Doc();
    seedResultsDoc(seed, [{ findingKey: KEY }]);
    await b.DB
        .prepare('INSERT INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at, report_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('row-gen', TENANT, INSPECTION, JSON.stringify(projectResults(seed)), Date.now(), REPORT)
        .run();
}

/** Open a socket the way the authorized route does and collect every frame the object sends. */
async function openSocket(name: string, claimedGen?: string): Promise<{ frames: Uint8Array[]; close: () => void; send: (data: Uint8Array) => void; closeCode: () => number | null }> {
    const headers: Record<string, string> = { ...HEADERS, Upgrade: 'websocket' };
    if (claimedGen !== undefined) headers[GEN_HEADER] = claimedGen;
    const res = await stub(name).fetch('https://do.test/collab/ws', { headers });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error('no websocket on the upgrade response');
    const frames: Uint8Array[] = [];
    ws.binaryType = 'arraybuffer';
    ws.accept();
    ws.addEventListener('message', (ev) => { frames.push(new Uint8Array(ev.data as ArrayBuffer)); });
    let code: number | null = null;
    ws.addEventListener('close', (ev) => { code = ev.code; });
    await new Promise<void>((r) => setTimeout(r, 50));
    return { frames, close: () => ws.close(), send: (data) => ws.send(data), closeCode: () => code };
}

function frameType(frame: Uint8Array): number {
    return decoding.readVarUint(decoding.createDecoder(frame));
}
function frameGeneration(frame: Uint8Array): string {
    const dec = decoding.createDecoder(frame);
    decoding.readVarUint(dec);
    return decoding.readVarString(dec);
}

/** Store what the object holds now (a database-built document has no stored state until its debounced save). */
async function persistNow(name: string): Promise<void> {
    await runInDurableObject(stub(name), async (instance) => { await (instance as unknown as DOInternals).persist(); });
}

async function exportedGen(name: string): Promise<string | null> {
    const res = await stub(name).fetch('https://do.test/state-export');
    return (await res.json<StateExport>()).gen;
}

beforeAll(seedDatabase);
beforeEach(seedDatabase);

describe('generation: the first frame of a socket', () => {
    it('is the generation, sent before the sync handshake', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        expect(sock.frames.map(frameType).slice(0, 2)).toEqual([MSG_GENERATION, MSG_SYNC]);
        expect(isGeneration(frameGeneration(sock.frames[0] ?? new Uint8Array()))).toBe(true);
        sock.close();
    });

    it('names the same history for every connection to the same object, and is what the export carries', async () => {
        const name = freshName();
        const one = await openSocket(name);
        const two = await openSocket(name);
        await persistNow(name);
        const first = frameGeneration(one.frames[0] ?? new Uint8Array());
        expect(frameGeneration(two.frames[0] ?? new Uint8Array())).toBe(first);
        expect(await exportedGen(name)).toBe(first);
        one.close();
        two.close();
    });

    it('differs between two documents', async () => {
        const a = await openSocket(freshName());
        const c = await openSocket(freshName());
        expect(frameGeneration(a.frames[0] ?? new Uint8Array())).not.toBe(frameGeneration(c.frames[0] ?? new Uint8Array()));
        a.close();
        c.close();
    });
});

/** A sync update that sets one key in a scratch map of the object's document: the probe for "was this client's write applied". */
function probeUpdate(value: string): Uint8Array {
    const client = new Y.Doc();
    let update: Uint8Array = new Uint8Array();
    client.on('update', (u: Uint8Array) => { update = u; });
    client.getMap('probe').set('x', value);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc);
}
async function probeValue(name: string): Promise<unknown> {
    return runInDurableObject(stub(name), async (instance) => (instance as unknown as DOInternals).doc.getMap('probe').get('x'));
}

describe('generation: the object checks the generation the client reports', () => {
    async function currentGen(name: string): Promise<string> {
        const first = await openSocket(name);
        const gen = frameGeneration(first.frames[0] ?? new Uint8Array());
        first.close();
        return gen;
    }

    it('a client reporting the current generation is served normally and its writes are applied', async () => {
        const name = freshName();
        const gen = await currentGen(name);
        const sock = await openSocket(name, gen);
        expect(sock.frames.map(frameType).slice(0, 2)).toEqual([MSG_GENERATION, MSG_SYNC]);
        sock.send(probeUpdate('current'));
        await new Promise<void>((r) => setTimeout(r, 50));
        expect(await probeValue(name)).toBe('current');
        expect(sock.closeCode()).toBeNull();
        sock.close();
    });

    it('a client that reports NO generation keeps the previous behaviour: served and writing (the documented residual window)', async () => {
        const name = freshName();
        await currentGen(name);
        const sock = await openSocket(name);
        sock.send(probeUpdate('legacy'));
        await new Promise<void>((r) => setTimeout(r, 50));
        expect(await probeValue(name)).toBe('legacy');
        expect(sock.closeCode()).toBeNull();
        sock.close();
    });

    it('a client reporting another generation gets the generation frame only, is closed with the stale-lineage code and writes nothing', async () => {
        const name = freshName();
        const gen = await currentGen(name);
        const sock = await openSocket(name, 'gen-stale-0001');
        expect(sock.frames.map(frameType)).toEqual([MSG_GENERATION]); // no step 1: nothing invites a reply
        expect(frameGeneration(sock.frames[0] ?? new Uint8Array())).toBe(gen);
        expect(sock.closeCode()).toBe(CLOSE_STALE_LINEAGE);
        try { sock.send(probeUpdate('stale')); } catch { /* a closed socket refuses, which is the point */ }
        await new Promise<void>((r) => setTimeout(r, 50));
        expect(await probeValue(name)).toBeUndefined();
    });

    it('a refused socket that was the only one does not make the object write its storage or the database', async () => {
        const name = freshName();
        const gen = await currentGen(name);
        await new Promise<void>((r) => setTimeout(r, 50));
        let writes = 0;
        await runInDurableObject(stub(name), async (instance) => {
            const io = instance as unknown as DOInternals;
            const original = io.persist.bind(io);
            io.persist = async () => { writes += 1; await original(); };
        });
        const before = writes;
        const sock = await openSocket(name, 'gen-stale-0001');
        expect(sock.closeCode()).toBe(CLOSE_STALE_LINEAGE);
        await new Promise<void>((r) => setTimeout(r, 100));
        expect(writes).toBe(before);
        // Control: an ordinary last disconnect still persists.
        const ok = await openSocket(name, gen);
        ok.close();
        await new Promise<void>((r) => setTimeout(r, 100));
        expect(writes).toBeGreaterThan(before);
    });

    it('closing or erroring a socket whose tags cannot be read does not throw, and still flushes', async () => {
        const name = freshName();
        await currentGen(name);
        let writes = 0;
        await runInDurableObject(stub(name), async (instance) => {
            const io = instance as unknown as DOInternals;
            const original = io.persist.bind(io);
            io.persist = async () => { writes += 1; await original(); };
            const handlers = instance as unknown as { webSocketClose(ws: WebSocket): Promise<void>; webSocketError(ws: WebSocket): Promise<void> };
            const fake = { close: () => undefined } as unknown as WebSocket; // never accepted: getTags throws for it
            await handlers.webSocketClose(fake);
            await handlers.webSocketError(fake);
        });
        expect(writes).toBe(2);
    });

    it('a malformed report is a mismatch, and the same client succeeds once it reports the new generation', async () => {
        const name = freshName();
        const gen = await currentGen(name);
        const bad = await openSocket(name, 'invalid');
        expect(bad.closeCode()).toBe(CLOSE_STALE_LINEAGE);
        const again = await openSocket(name, gen);
        expect(again.closeCode()).toBeNull();
        again.send(probeUpdate('after'));
        await new Promise<void>((r) => setTimeout(r, 50));
        expect(await probeValue(name)).toBe('after');
        again.close();
    });

    it('after a version restore a client still reporting the previous generation is refused, one reporting the new one is not', async () => {
        const name = freshName();
        const before = await currentGen(name);
        const snap = await stub(name).fetch('https://do.test/snapshots', { method: 'POST', headers: HEADERS });
        const { seq } = await snap.json<{ seq: number }>();
        expect((await stub(name).fetch('https://do.test/restore', { method: 'POST', headers: HEADERS, body: JSON.stringify({ seq }) })).status).toBe(200);
        const after = await exportedGen(name);
        const old = await openSocket(name, before);
        expect(old.closeCode()).toBe(CLOSE_STALE_LINEAGE);
        expect(frameGeneration(old.frames[0] ?? new Uint8Array())).toBe(after);
        const fresh = await openSocket(name, after ?? '');
        expect(fresh.closeCode()).toBeNull();
        fresh.close();
    });
});

describe('generation: kept through hibernation, minted for a legacy object', () => {
    it('is preserved when the object rehydrates from its storage', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        const gen = frameGeneration(sock.frames[0] ?? new Uint8Array());
        sock.close();
        await persistNow(name);
        await runInDurableObject(stub(name), async (instance) => { await (instance as unknown as DOInternals).hydrate(); });
        expect(await exportedGen(name)).toBe(gen);
    });

    it('a restart BEFORE the first save mints a new generation: the document is rebuilt from the database as a new history', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        const first = frameGeneration(sock.frames[0] ?? new Uint8Array());
        sock.close();
        // Nothing has been saved yet: the storage holds the generation but no document.
        await runInDurableObject(stub(name), async (instance) => {
            const io = instance as unknown as DOInternals;
            await io.ctx.storage.delete('ydoc');
            await io.hydrate();
            expect(await io.ctx.storage.get('gen')).not.toBe(first);
        });
        const again = await openSocket(name);
        expect(frameGeneration(again.frames[0] ?? new Uint8Array())).not.toBe(first);
        again.close();
    });

    it('is minted lazily for an object whose storage predates generations, and then stays', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        sock.close();
        await persistNow(name);
        await runInDurableObject(stub(name), async (instance) => {
            await (instance as unknown as DOInternals).ctx.storage.delete('gen');
        });
        await runInDurableObject(stub(name), async (instance) => { await (instance as unknown as DOInternals).hydrate(); });
        const minted = await exportedGen(name);
        expect(isGeneration(minted)).toBe(true);
        await runInDurableObject(stub(name), async (instance) => { await (instance as unknown as DOInternals).hydrate(); });
        expect(await exportedGen(name)).toBe(minted);
    });
});

describe('generation: a rebuilt history gets a new id, a same-history change does not', () => {
    async function snapshotSeq(name: string): Promise<number> {
        const res = await stub(name).fetch('https://do.test/snapshots', { method: 'POST', headers: HEADERS });
        return (await res.json<{ seq: number }>()).seq;
    }

    it('a version restore mints a new generation and tells connected clients in the restore frame', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        const before = frameGeneration(sock.frames[0] ?? new Uint8Array());
        const seq = await snapshotSeq(name);
        const res = await stub(name).fetch('https://do.test/restore', { method: 'POST', headers: HEADERS, body: JSON.stringify({ seq }) });
        expect(res.status).toBe(200);
        await new Promise<void>((r) => setTimeout(r, 50));
        const after = await exportedGen(name);
        expect(isGeneration(after)).toBe(true);
        expect(after).not.toBe(before);
        const restore = sock.frames.find((f) => frameType(f) === MSG_RESTORE);
        expect(restore ? frameGeneration(restore) : null).toBe(after);
        // A client that reconnects is told the new id first.
        const again = await openSocket(name);
        expect(frameGeneration(again.frames[0] ?? new Uint8Array())).toBe(after);
        sock.close();
        again.close();
    });

    it('a version restore stores the new generation and the restored document in ONE write, before it tells any client', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        const seq = await snapshotSeq(name);
        const puts: Array<{ keys: string[]; frames: number }> = [];
        await runInDurableObject(stub(name), async (instance) => {
            const storage = (instance as unknown as DOInternals).ctx.storage;
            const original = storage.put.bind(storage);
            storage.put = (async (...args: unknown[]) => {
                if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) puts.push({ keys: Object.keys(args[0]), frames: sock.frames.length });
                return (original as (...a: unknown[]) => Promise<void>)(...args);
            }) as typeof storage.put;
        });
        const framesBefore = sock.frames.length;
        const res = await stub(name).fetch('https://do.test/restore', { method: 'POST', headers: HEADERS, body: JSON.stringify({ seq }) });
        expect(res.status).toBe(200);
        await new Promise<void>((r) => setTimeout(r, 50));
        const both = puts.find((p) => p.keys.includes('gen') && p.keys.includes('ydoc'));
        expect(both).toBeDefined();
        expect(both?.frames).toBe(framesBefore); // no restore frame had been sent yet
        expect(puts.some((p) => p.keys.includes('gen') && !p.keys.includes('ydoc'))).toBe(false);
        sock.close();
    });

    it('a restructure (same history) keeps the generation, and its restore frame carries it', async () => {
        const name = freshName();
        const sock = await openSocket(name);
        const before = frameGeneration(sock.frames[0] ?? new Uint8Array());
        const res = await stub(name).fetch('https://do.test/restructure', { method: 'POST', headers: HEADERS });
        expect(res.status).toBe(200);
        await new Promise<void>((r) => setTimeout(r, 50));
        expect(await exportedGen(name)).toBe(before);
        const restore = sock.frames.find((f) => frameType(f) === MSG_RESTORE);
        expect(restore ? frameGeneration(restore) : null).toBe(before);
        sock.close();
    });
});

describe('generation: travels with the document through a state transfer', () => {
    it('an import into an empty object makes the live object announce the SOURCE generation', async () => {
        const source = freshName();
        const first = await openSocket(source);
        const sourceGen = frameGeneration(first.frames[0] ?? new Uint8Array());
        first.close();
        await persistNow(source);
        const exported = await (await stub(source).fetch('https://do.test/state-export')).text();
        const target = freshName();
        const res = await stub(target).fetch('https://do.test/state-import', { method: 'POST', body: exported });
        expect(res.status).toBe(200);
        expect(await exportedGen(target)).toBe(sourceGen);
        const sock = await openSocket(target);
        expect(frameGeneration(sock.frames[0] ?? new Uint8Array())).toBe(sourceGen);
        sock.close();
    });
});
