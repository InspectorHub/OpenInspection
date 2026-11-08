/**
 * Moving a collab document between Durable Object ids (workerd).
 *
 * A jurisdiction-pinned object has a different id from the unpinned one with the same name, so its stored state has to be
 * copied across once. Covers: content, identity and restore points arrive intact; a second import is refused so it can never
 * overwrite newer edits; a malformed import writes nothing.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';

interface TestBindings {
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as unknown as TestBindings;

const IDENTITY = { tenantId: 't-1', inspectionId: 'i-1', reportId: 'r-1' };
const SNAPSHOTS = [{ seq: 1, atMs: 1700000000000, byUserId: 'u-1', reason: 'manual', projection: { marker: 'restore-point' } }];

function stub(name: string) {
    return b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
}

function sourceBytes(): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap('probe').set('finding', 'cracked flashing');
    return Y.encodeStateAsUpdate(doc);
}

async function seedSource(name: string): Promise<Uint8Array> {
    const bytes = sourceBytes();
    await runInDurableObject(stub(name), async (_i, state) => {
        await state.storage.put('ydoc', bytes);
        await state.storage.put('identity', IDENTITY);
        await state.storage.put('snapshots', SNAPSHOTS);
    });
    return bytes;
}

const url = (path: string) => `https://do.test/${path}`;

describe('InspectionDocDO state transfer', () => {
    it('exports content, identity and snapshots, and a fresh object accepts them', async () => {
        const bytes = await seedSource('src-1');
        const exported = await stub('src-1').fetch(url('state-export'));
        expect(exported.status).toBe(200);
        const payload = (await exported.json()) as { ydoc: string; identity: unknown; snapshots: unknown };
        expect(payload.identity).toEqual(IDENTITY);
        expect(payload.snapshots).toEqual(SNAPSHOTS);

        const target = stub('dst-1');
        const imported = await target.fetch(url('state-import'), { method: 'POST', body: JSON.stringify(payload) });
        expect(imported.status).toBe(200);

        const stored = await runInDurableObject(target, async (_i, state) => ({
            ydoc: await state.storage.get<Uint8Array>('ydoc'),
            identity: await state.storage.get('identity'),
            snapshots: await state.storage.get('snapshots'),
        }));
        expect(Array.from(stored.ydoc ?? [])).toEqual(Array.from(bytes));
        expect(stored.identity).toEqual(IDENTITY);
        expect(stored.snapshots).toEqual(SNAPSHOTS);
    });

    it('refuses a second import into an object that already holds state, and keeps what it had', async () => {
        await seedSource('src-2');
        const payload = await (await stub('src-2').fetch(url('state-export'))).text();
        const target = stub('dst-2');
        expect((await target.fetch(url('state-import'), { method: 'POST', body: payload })).status).toBe(200);

        const other = JSON.parse(payload) as { snapshots: unknown[] };
        other.snapshots = [];
        const again = await target.fetch(url('state-import'), { method: 'POST', body: JSON.stringify(other) });
        expect(again.status).toBe(409);
        const kept = await runInDurableObject(target, (_i, state) => state.storage.get('snapshots'));
        expect(kept).toEqual(SNAPSHOTS);
    });

    it('rejects a malformed import and writes nothing', async () => {
        const target = stub('dst-3');
        for (const body of ['not json', JSON.stringify({}), JSON.stringify({ ydoc: 'AAAA' }), JSON.stringify({ ydoc: 'AAAA', identity: { tenantId: 't' } })]) {
            const res = await target.fetch(url('state-import'), { method: 'POST', body });
            expect(res.status).toBe(400);
        }
        const stored = await runInDurableObject(target, (_i, state) => state.storage.get('ydoc'));
        expect(stored).toBeUndefined();
    });

    it('exporting an object with no state returns nulls rather than failing', async () => {
        const res = await stub('src-empty').fetch(url('state-export'));
        expect(await res.json()).toEqual({ ydoc: null, identity: null, snapshots: [] });
    });
});
