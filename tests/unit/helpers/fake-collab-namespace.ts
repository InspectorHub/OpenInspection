/**
 * A stand-in for a collab Durable Object namespace that answers the real state-transfer verbs over a Map per object.
 *
 * It runs `handleStateTransfer` itself, so a spec built on it exercises the rules that ship (refusals, markers, atomic
 * replace) rather than a re-statement of them. The object id is `id(<name>)`, which keeps ids readable in assertions.
 */
import * as Y from 'yjs';
import { applyItemPatch, seedResultsDoc } from '../../../packages/field-ui/src/shared/results-doc';
import { handleStateTransfer, type StateKeys, type StoredValue, type TransferIdentity } from '../../../server/durable-objects/inspection-doc-state-transfer';
import { PURGE_TENANT_HEADER, purgeAllowed, purgePathMatches, purgePrecondition } from '../../../server/durable-objects/purge-path';
import type { DocNamespace } from '../../../server/lib/collab/do-jurisdiction-migrate';

export const KEYS: StateKeys = { ydoc: 'ydoc', identity: 'identity', snapshots: 'snapshots', derived: 'derived-from-d1', backup: 'replaced-derived-backup', gen: 'gen' };

/** A real encoded results document with one finding carrying `rating`, as the editor would have built it. */
export function ratedDocBytes(rating: string): Uint8Array {
    const d = new Y.Doc();
    seedResultsDoc(d, [{ findingKey: 'a:b:c' }]);
    applyItemPatch(d, 'a:b:c', 'rating', rating);
    return Y.encodeStateAsUpdate(d);
}

/** A real encoded results document. */
export function docBytes(marker: string): Uint8Array {
    const d = new Y.Doc();
    d.getMap('results').set('marker', marker);
    return Y.encodeStateAsUpdate(d);
}

export interface FakeNamespace extends DocNamespace<string> {
    stores: Map<string, Map<string, StoredValue>>;
    calls: string[];
}

export function fakeNamespace(initial: Record<string, Record<string, StoredValue>>, opts: { failImportFor?: string; liveFor?: string[]; failExportFor?: string; failPurgeFor?: string; liveAtPurgeFor?: string[] } = {}): FakeNamespace {
    const stores = new Map(Object.entries(initial).map(([name, kv]) => [name, new Map(Object.entries(kv))]));
    const calls: string[] = [];
    return {
        stores, calls,
        idFromName: (n) => `id(${n})`,
        get: (id) => {
            const name = id.slice(3, -1);
            const data = stores.get(name) ?? new Map<string, StoredValue>();
            stores.set(name, data);
            return {
                fetch: async (url, init) => {
                    const path = new URL(url).pathname;
                    calls.push(`${init?.method ?? 'GET'} ${path} ${name}`);
                    if (path === '/state-import' && name === opts.failImportFor) return new Response('boom', { status: 500 });
                    if (path === '/state-export' && name === opts.failExportFor) return new Response('boom', { status: 500 });
                    if (purgePathMatches(path) && init?.method === 'POST') {
                        // The same ownership rule the object applies (purge-path.ts), over the same stored keys.
                        if (name === opts.failPurgeFor) return new Response('boom', { status: 500 });
                        const refused = await purgePrecondition(new Request(url, init), () => opts.liveAtPurgeFor?.includes(name) ?? false, async () => ({ ydoc: data.get('ydoc'), snapshots: data.get('snapshots') })); // the shipped rule
                        if (refused) return Response.json({ error: refused }, { status: 409 });
                        const expected = new Headers(init.headers).get(PURGE_TENANT_HEADER);
                        const idv = data.get('identity');
                        const storedTenant = idv && typeof idv === 'object' && !(idv instanceof Uint8Array) && !Array.isArray(idv) && 'tenantId' in idv ? idv.tenantId : null;
                        const verdict = purgeAllowed(expected, storedTenant, [...data.keys()].some((k) => k !== 'gen'));
                        if (verdict !== 'ok') return Response.json({ error: verdict }, { status: 403 });
                        data.clear();
                        return Response.json({ purged: true });
                    }
                    const res = await handleStateTransfer(new Request(url, init), path, {
                        keys: KEYS,
                        storage: {
                            get: async (keys) => new Map(keys.flatMap((k) => (data.has(k) ? [[k, data.get(k) as StoredValue] as const] : []))),
                            put: async (entries) => { for (const [k, v] of Object.entries(entries)) data.set(k, v); },
                        },
                        live: () => opts.liveFor?.includes(name) ?? false,
                        flush: async () => undefined,
                        adopt: () => undefined,
                    });
                    return res ?? new Response('not found', { status: 404 });
                },
            };
        },
    };
}

export const identity = (t = 't1', i = 'i1', r: string | null = 'r1'): TransferIdentity => ({ tenantId: t, inspectionId: i, reportId: r });

export const stored = (bytes: Uint8Array, id: TransferIdentity | null = identity(), derived?: boolean): Record<string, StoredValue> => ({
    ydoc: bytes,
    ...(id ? { identity: id } : {}),
    ...(derived === undefined ? {} : { 'derived-from-d1': derived }),
});
