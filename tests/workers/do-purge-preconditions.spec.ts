/**
 * The opt-in preconditions of an InspectionDocDO purge, in real workerd: refuse while the object is live (a real open
 * WebSocket, not a stand-in) and compare-and-delete on the stored document's digest. The headers are sent only by the verified
 * source purge of a jurisdiction migration; every refusal has a positive control in the same test.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import * as Y from 'yjs';
import { PURGE_IF_IDLE_HEADER, PURGE_IF_SNAPSHOTS_HEADER, PURGE_IF_YDOC_HEADER, purgeDigest, purgeSnapshotsDigest } from '../../server/durable-objects/purge-path';
import { base64ToBytes, type StateExport } from '../../server/durable-objects/inspection-doc-state-transfer';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';

const b = env as unknown as { DB: D1Database; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> };

const wsHeaders = (tenant: string, report: string): Record<string, string> => ({
    Upgrade: 'websocket', 'x-tenant-id': tenant, 'x-inspection-id': 'insp-pre', 'x-report-id': report, 'x-user-id': 'u1',
});
const purge = (headers: Record<string, string> = {}) => new Request('https://do.local/purge', { method: 'POST', headers });
const keysOf = (stub: DurableObjectStub) => runInDurableObject(stub, async (_i, ctx) => [...(await ctx.storage.list()).keys()].filter((k) => k !== 'gen'));

describe('InspectionDocDO purge preconditions', () => {
    beforeAll(async () => {
        await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
    });

    const fresh = () => b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`pre-tenant:${crypto.randomUUID()}`));

    it('refuses an idle-only purge while a real WebSocket is open, and purges once it is closed (control)', async () => {
        const stub = fresh();
        await runInDurableObject(stub, async (instance: InspectionDocDO, ctx) => {
            const res = await instance.fetch(new Request('https://do.local/ws', { headers: wsHeaders('pre-tenant', 'rep-ws') }));
            const client = res.webSocket!;
            client.accept();
            expect(ctx.getWebSockets().length).toBeGreaterThan(0);
            const before = [...(await ctx.storage.list()).keys()];

            const refused = await instance.fetch(purge({ [PURGE_IF_IDLE_HEADER]: '1' }));
            expect(refused.status).toBe(409);
            expect(await refused.json()).toEqual({ error: 'live' });
            expect([...(await ctx.storage.list()).keys()]).toEqual(before); // nothing deleted

            client.close();
            await new Promise((r) => setTimeout(r, 100));
        });
        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            expect((await instance.fetch(purge({ [PURGE_IF_IDLE_HEADER]: '1' }))).status).toBe(200);
        });
        expect(await keysOf(stub)).toEqual([]);
    });

    it('compare-and-delete: deletes only while the stored document still has the digest the caller read', async () => {
        const stub = fresh();
        const bytes = new Uint8Array([9, 8, 7, 6]);
        await runInDurableObject(stub, (_i, ctx) => ctx.storage.put('ydoc', bytes));
        const stale = await purgeDigest(new Uint8Array([9, 8, 7]));

        const changed = await stub.fetch(purge({ [PURGE_IF_YDOC_HEADER]: stale }));
        expect(changed.status).toBe(409);
        expect(await changed.json()).toEqual({ error: 'changed' });
        expect(await keysOf(stub)).toContain('ydoc');

        const ok = await stub.fetch(purge({ [PURGE_IF_YDOC_HEADER]: await purgeDigest(bytes) }));
        expect(ok.status).toBe(200);
        expect(await keysOf(stub)).toEqual([]);
    });

    it('compare-and-delete: an object with no document at all counts as changed, and no header means no comparison', async () => {
        const empty = fresh();
        const res = await empty.fetch(purge({ [PURGE_IF_YDOC_HEADER]: await purgeDigest(new Uint8Array([1])) }));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'changed' });

        const plain = fresh();
        await runInDurableObject(plain, (_i, ctx) => ctx.storage.put('ydoc', new Uint8Array([5])));
        expect((await plain.fetch(purge())).status).toBe(200);
        expect(await keysOf(plain)).toEqual([]);
    });

    it('compare-and-delete covers the restore points: a snapshot taken after the read (document unchanged) keeps the object', async () => {
        const stub = fresh();
        const doc = new Y.Doc();
        doc.getMap('results').set('marker', 'x');
        await runInDurableObject(stub, (_i, ctx) => ctx.storage.put('ydoc', Y.encodeStateAsUpdate(doc)));
        const snapshot = () => stub.fetch(new Request('https://do.local/snapshots', { method: 'POST', headers: { 'x-user-id': 'u1' } }));
        const read = async (): Promise<Record<string, string>> => {
            const out = await (await stub.fetch(new Request('https://do.local/state-export'))).json<StateExport>();
            return { [PURGE_IF_YDOC_HEADER]: await purgeDigest(base64ToBytes(out.ydoc as string)), [PURGE_IF_SNAPSHOTS_HEADER]: await purgeSnapshotsDigest(out.snapshots) };
        };
        expect((await snapshot()).status).toBe(200);
        const headers = await read();
        expect((await snapshot()).status).toBe(200); // between the read and the delete; the document bytes do not change
        const refused = await stub.fetch(purge(headers));
        expect(refused.status).toBe(409);
        expect(await refused.json()).toEqual({ error: 'changed' });
        expect(await keysOf(stub)).toContain('snapshots');
        // Control: read again after the last change and the same purge goes through.
        expect((await stub.fetch(purge(await read()))).status).toBe(200);
        expect(await keysOf(stub)).toEqual([]);
    });

    it('a precondition header that is present but malformed is refused, never read as no precondition', async () => {
        const stub = fresh();
        await runInDurableObject(stub, (_i, ctx) => ctx.storage.put('ydoc', new Uint8Array([5])));
        const malformed: Array<Record<string, string>> = [{ [PURGE_IF_IDLE_HEADER]: '0' }, { [PURGE_IF_IDLE_HEADER]: '' }, { [PURGE_IF_YDOC_HEADER]: 'nothex' }, { [PURGE_IF_SNAPSHOTS_HEADER]: '' }];
        for (const headers of malformed) {
            const res = await stub.fetch(purge(headers));
            expect(res.status).toBe(409);
            expect(await res.json()).toEqual({ error: 'bad-precondition' });
        }
        expect(await keysOf(stub)).toContain('ydoc');
    });
});
