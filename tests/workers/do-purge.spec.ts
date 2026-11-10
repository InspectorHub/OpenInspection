/**
 * The two Durable Objects that hold storage can actually empty it.
 *
 * `tests/unit/durable-objects/purge.spec.ts` asserts the path matcher, which is
 * a regex and would pass against two classes that never call it. This is the
 * half that cannot: real workerd, real DO storage, something written into it,
 * and an assertion that the storage is empty afterwards.
 *
 * The negative controls matter as much as the positive ones. A destructive verb
 * reached from a path that merely resembles it, or from a GET, is unrecoverable
 * — so each is driven for real and the storage checked to still be there. A
 * suite that only proves purge works would be green against a class that purges
 * on every request.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { GEN_KEY } from '../../server/durable-objects/inspection-doc-generation';
import type { TenantPresenceDO } from '../../server/durable-objects/tenant-presence';

const b = env as unknown as {
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
    TENANT_PRESENCE: DurableObjectNamespace<TenantPresenceDO>;
};

const TENANT = 'tenant-do-purge';
const REPORT = 'report-do-purge';

/** Anything at all in storage, so "empty afterwards" is a real observation. */
async function seed(stub: DurableObjectStub, entries: Record<string, unknown>): Promise<void> {
    await runInDurableObject(stub, async (_inst, ctx) => {
        for (const [k, v] of Object.entries(entries)) await ctx.storage.put(k, v);
    });
}

async function storedKeys(stub: DurableObjectStub): Promise<string[]> {
    return runInDurableObject(stub, async (_inst, ctx) => {
        const map = await ctx.storage.list();
        return [...map.keys()];
    });
}

function post(path: string): Request {
    return new Request(`https://do.local${path}`, { method: 'POST' });
}

/** The two keys the Inspection DO block seeds. */
const SEEDED_KEYS = ['ydoc:update:1', 'snapshot:0'];

/**
 * Both seeded keys are still there, and the only other thing the object may hold is its lineage generation (GEN_KEY), which it
 * mints when it wakes, so whether it is present depends on which request woke it. Anything else would be an unexpected write.
 */
function expectSeededIntact(keys: string[]): void {
    for (const k of SEEDED_KEYS) expect(keys).toContain(k);
    expect(keys.filter((k) => !SEEDED_KEYS.includes(k)).every((k) => k === GEN_KEY)).toBe(true);
}

describe('InspectionDocDO purge', () => {
    let stub: DurableObjectStub;
    beforeEach(async () => {
        // Addressed exactly as collabDocName builds it — `${tenantId}:${reportId}`.
        stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${REPORT}`));
        await seed(stub, { 'ydoc:update:1': new Uint8Array([1, 2, 3]), 'snapshot:0': { seq: 0 } });
    });

    it('empties its storage and says so', async () => {
        expectSeededIntact(await storedKeys(stub));

        const res = await stub.fetch(post('/purge'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ purged: true });

        // Exactly empty: the seeded keys AND the lineage generation are gone.
        expect(await storedKeys(stub)).toEqual([]);
    });

    it('refuses an idle-only purge while a save is waiting (the object is live), and purges once it is idle', async () => {
        await runInDurableObject(stub, (inst) => { Reflect.set(inst, 'persistTimer', setTimeout(() => undefined, 60_000)); });
        const idleOnly = () => new Request('https://do.local/purge', { method: 'POST', headers: { 'x-purge-if-idle': '1' } });
        const refused = await stub.fetch(idleOnly());
        expect(refused.status).toBe(409);
        expect(await refused.json()).toEqual({ error: 'live' });
        expectSeededIntact(await storedKeys(stub));
        await runInDurableObject(stub, (inst) => { clearTimeout(Reflect.get(inst, 'persistTimer')); Reflect.set(inst, 'persistTimer', null); });
        expect((await stub.fetch(idleOnly())).status).toBe(200);
        expect(await storedKeys(stub)).toEqual([]);
    });

    it('an unconditional purge still empties a live object (a workspace purge destroys open sessions on purpose)', async () => {
        await runInDurableObject(stub, (inst) => { Reflect.set(inst, 'persistTimer', setTimeout(() => undefined, 60_000)); });
        expect((await stub.fetch(post('/purge'))).status).toBe(200);
        expect(await storedKeys(stub)).toEqual([]);
        await runInDurableObject(stub, (inst) => { clearTimeout(Reflect.get(inst, 'persistTimer')); Reflect.set(inst, 'persistTimer', null); });
    });

    it('does not purge on a path that only resembles the verb', async () => {
        const res = await stub.fetch(post('/purged'));
        expect(res.status).toBe(404);
        expectSeededIntact(await storedKeys(stub));
    });

    describe('with an expected tenant', () => {
        const withTenant = (tenant: string) => new Request('https://do.local/purge', { method: 'POST', headers: { 'x-expected-tenant': tenant } });

        it('refuses an object that stores the identity of another tenant, and deletes nothing', async () => {
            await seed(stub, { identity: { tenantId: TENANT, inspectionId: 'i1', reportId: REPORT } });
            const res = await stub.fetch(withTenant('some-other-tenant'));
            expect(res.status).toBe(403);
            const keys = await storedKeys(stub);
            for (const k of [...SEEDED_KEYS, 'identity']) expect(keys).toContain(k);
        });

        it('purges an object whose stored identity names that tenant', async () => {
            await seed(stub, { identity: { tenantId: TENANT, inspectionId: 'i1', reportId: REPORT } });
            const res = await stub.fetch(withTenant(TENANT));
            expect(res.status).toBe(200);
            expect(await storedKeys(stub)).toEqual([]);
        });

        it('refuses an object that holds a document but no identity, since it cannot be attributed', async () => {
            const res = await stub.fetch(withTenant(TENANT));
            expect(res.status).toBe(403);
            expectSeededIntact(await storedKeys(stub));
        });

        it('purges an object that holds nothing', async () => {
            const empty = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:never-written`));
            const res = await empty.fetch(withTenant(TENANT));
            expect(res.status).toBe(200);
        });
    });

    it('does not purge on a GET', async () => {
        const res = await stub.fetch(new Request('https://do.local/purge'));
        expect(res.status).toBe(404);
        expectSeededIntact(await storedKeys(stub));
    });
});

describe('TenantPresenceDO purge', () => {
    let stub: DurableObjectStub;
    beforeEach(async () => {
        // Addressed by the bare tenant id, which the destruction record already
        // snapshots — so unlike its sibling this one needs no pre-cascade
        // collection to be reachable.
        stub = b.TENANT_PRESENCE.get(b.TENANT_PRESENCE.idFromName(TENANT));
        await seed(stub, { state: { members: { u1: { online: true, lastSeenAt: 1 } } } });
    });

    it('empties its storage and says so', async () => {
        expect(await storedKeys(stub)).toEqual(['state']);

        const res = await stub.fetch(post('/purge'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ purged: true });

        expect(await storedKeys(stub)).toHaveLength(0);
    });

    it('leaves the sibling roster route working', async () => {
        // The purge branch sits after `/inspection-roster` in the same fetch, so
        // this asserts the new branch did not shadow a live one.
        const res = await stub.fetch(new Request('https://do.local/inspection-roster', {
            method: 'POST',
            body: JSON.stringify({ inspectionId: 'i1', users: [{ userId: 'u2' }] }),
        }));
        expect(res.status).toBe(200);
        expect(await storedKeys(stub)).toEqual(['state']);
    });
});
