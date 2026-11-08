/**
 * Durable Object ids as the orphan-purge route uses them (workerd).
 *
 * The route `POST /api/platform/tenants/:slug/inspection-doc/purge` takes the hex id string an operator copies out of the logs
 * and reaches the object with `namespace.get(namespace.idFromString(hex))`. That is only safe if (a) the string of an id minted
 * by `idFromName` / `newUniqueId` round-trips to an id for the SAME object, and (b) a malformed or foreign string is refused
 * rather than silently addressing some other object. Both are asserted here against real workerd.
 *
 * Jurisdiction: the local workerd runtime does not implement jurisdictions (`namespace.jurisdiction('us')` throws "Jurisdiction
 * restrictions are not implemented in workerd"), so what a pinned namespace does with `idFromString` cannot be proven in this
 * suite. The test below records that fact and, if a later runtime does implement it, runs the same round trip through a pinned
 * namespace. Only the deployed platform can show the pinned behaviour today.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

interface TestBindings {
    INSPECTION_DOC: DurableObjectNamespace;
    TENANT_PRESENCE: DurableObjectNamespace;
}
// The generated Env does not list these bindings; a narrowing assertion adds them without going through unknown.
const b = env as typeof env & TestBindings;
const ns = b.INSPECTION_DOC;

async function seed(id: DurableObjectId, marker: string): Promise<void> {
    await runInDurableObject(ns.get(id), async (_i, state) => { await state.storage.put('marker', marker); });
}
async function marker(id: DurableObjectId): Promise<string | undefined> {
    return runInDurableObject(ns.get(id), (_i, state) => state.storage.get<string>('marker'));
}

describe('idFromString on the collab namespace', () => {
    it('an id from idFromName round-trips through its string to the same object', async () => {
        const named = ns.idFromName('t-1:r-1');
        await seed(named, 'named');
        const again = ns.idFromString(named.toString());
        expect(again.equals(named)).toBe(true);
        expect(await marker(again)).toBe('named');
    });

    it('an id from newUniqueId round-trips too, and is not the id of any name', async () => {
        const unique = ns.newUniqueId();
        await seed(unique, 'unique');
        expect(await marker(ns.idFromString(unique.toString()))).toBe('unique');
        expect(unique.equals(ns.idFromName('t-1:r-1'))).toBe(false);
    });

    it('the purge verb, reached by id string, empties exactly that object and leaves a neighbour alone', async () => {
        const a = ns.idFromName('t-1:purge-a');
        const b = ns.idFromName('t-1:purge-b');
        await seed(a, 'a');
        await seed(b, 'b');
        const res = await ns.get(ns.idFromString(a.toString())).fetch('https://do/purge', { method: 'POST' });
        expect(res.status).toBe(200);
        expect(await marker(a)).toBeUndefined();
        expect(await marker(b)).toBe('b');
    });

    it('purging a name that never existed is a no-op that answers ok', async () => {
        const res = await ns.get(ns.idFromName('t-never:r-never')).fetch('https://do/purge', { method: 'POST' });
        expect(res.status).toBe(200);
    });

    it('refuses a string that is not a Durable Object id, rather than addressing something', () => {
        for (const bad of ['', 'not-hex', 'zz'.repeat(32), 'ab'.repeat(8)]) {
            expect(() => ns.idFromString(bad)).toThrow();
        }
    });

    it('refuses an id string minted for a different class', () => {
        const other = b.TENANT_PRESENCE.idFromName('t-1').toString();
        expect(() => ns.idFromString(other)).toThrow();
    });
});

/**
 * `namespace.jurisdiction(name)` through the runtime method itself. The worker types generated for this repository predate
 * the `us` jurisdiction (their union is eu | fedramp | fedramp-high), so the declared signature cannot name it, while the
 * platform and `do-jurisdiction.ts` (`DoJurisdiction`) do. Reflect keeps the call honest without a cast.
 */
function jurisdictionOf(namespace: DurableObjectNamespace, name: string): DurableObjectNamespace {
    return Reflect.apply(Reflect.get(namespace, 'jurisdiction'), namespace, [name]);
}

describe('jurisdiction in the local runtime', () => {
    it('is not implemented by workerd, so a pinned id cannot be exercised here; if it ever is, the round trip must hold', async () => {
        let pinned: DurableObjectNamespace | null = null;
        try { pinned = jurisdictionOf(ns, 'us'); } catch (e) {
            expect(String(e)).toMatch(/not implemented in workerd/);
        }
        if (!pinned) return;
        const id = pinned.newUniqueId();
        expect(pinned.idFromString(id.toString()).equals(id)).toBe(true);
        expect(ns.idFromString(id.toString()).equals(id)).toBe(true);
    });
});
