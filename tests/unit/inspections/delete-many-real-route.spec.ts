/**
 * The list's batch delete, run against the REAL route and cascade (in-memory
 * SQLite, real middleware and JWT, no mock of the API seam). Only the client
 * object is an adapter: its `$delete` / `$get` issue the same request the typed
 * client would, straight into the application.
 *
 * Pinned here:
 *   - several inspections (with children) go in ONE call, rows and children,
 *   - the batch is capped (a single request may not run an unbounded number of
 *     cascades in one Worker invocation),
 *   - repeating a delete is a success for every role, including a lead
 *     inspector, for whom the route answers 403 (not 404) for an id that no
 *     longer exists.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';
import { deleteInspectionsViaApi, MAX_DELETE_BATCH } from '../../../app/lib/inspection-delete.server';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `55555555-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

async function setup(count: number, lead: string) {
    const h = await createHarness('standalone');
    const now = new Date();
    (h.env as unknown as Record<string, unknown>).PHOTOS = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined };
    const all = ids(count);
    await h.db.insert(schema.inspections).values(all.map((id) => ({
        id, tenantId: TENANT_ID, propertyAddress: `${id.slice(-2)} Real Road`, date: '2026-06-01', status: 'scheduled',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, inspectorId: lead, createdAt: now,
    })) as never);
    await h.db.insert(schema.inspectionInspectors).values(all.map((id) => ({ inspectionId: id, userId: lead, tenantId: TENANT_ID, role: 'lead' as const, createdAt: now })));
    await h.db.insert(schema.inspectionResults).values(all.map((id) => ({ id: `res-${id}`, tenantId: TENANT_ID, inspectionId: id, data: '{}', lastSyncedAt: now, createdAt: now })) as never);
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const tokenFor = (sub: string, role: string) => signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': role, iat, exp: iat + 3600 }, keyring);
    const call = (token: string) => async (method: string, id: string) => {
        const exec = makeExecutionContext({ label: method });
        const res = await app.request(`/api/inspections/${id}`, { method, headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const apiFor = (token: string) => {
        const c = call(token);
        return { inspections: { ':id': { $delete: ({ param }: { param: { id: string } }) => c('DELETE', param.id), $get: ({ param }: { param: { id: string } }) => c('GET', param.id) } } } as never;
    };
    const remaining = async () => (await h.db.select({ id: schema.inspections.id }).from(schema.inspections).all()).length;
    const results = async () => (await h.db.select({ id: schema.inspectionResults.id }).from(schema.inspectionResults).all()).length;
    return { h, tokenFor, apiFor, all, remaining, results, db: h.db };
}

describe('batch delete through the real route and cascade', () => {
    it('deletes four inspections and their children in one call', async () => {
        const { h, tokenFor, apiFor, all, remaining, results } = await setup(4, OWNER_ID);
        try {
            const out = await deleteInspectionsViaApi(apiFor(await tokenFor(OWNER_ID, 'owner')), all);
            expect(out).toMatchObject({ ok: true, deleted: all, failed: [] });
            expect(await remaining()).toBe(0);
            expect(await results()).toBe(0);
        } finally { h.close(); }
    });

    it('a batch past the cap is refused whole and deletes nothing', async () => {
        const { h, tokenFor, apiFor, all, remaining } = await setup(MAX_DELETE_BATCH + 1, OWNER_ID);
        try {
            const out = await deleteInspectionsViaApi(apiFor(await tokenFor(OWNER_ID, 'owner')), all);
            expect(out.ok).toBe(false);
            expect(out.deleted).toEqual([]);
            expect(out.tooMany).toBe(true);
            expect(await remaining()).toBe(all.length);
        } finally { h.close(); }
    });

    it('a batch at the cap goes through', async () => {
        const { h, tokenFor, apiFor, all, remaining } = await setup(MAX_DELETE_BATCH, OWNER_ID);
        try {
            expect((await deleteInspectionsViaApi(apiFor(await tokenFor(OWNER_ID, 'owner')), all)).ok).toBe(true);
            expect(await remaining()).toBe(0);
        } finally { h.close(); }
    });

    it('a lead inspector repeating a delete still gets a success (the route answers 403 for a missing id)', async () => {
        const { h, tokenFor, apiFor, all, remaining } = await setup(2, INSPECTOR_ID);
        try {
            const api = apiFor(await tokenFor(INSPECTOR_ID, 'inspector'));
            expect((await deleteInspectionsViaApi(api, all)).ok).toBe(true);
            expect(await remaining()).toBe(0);
            const again = await deleteInspectionsViaApi(api, all);
            expect(again).toMatchObject({ ok: true, deleted: all, failed: [] });
        } finally { h.close(); }
    });

    it('CONTROL: an inspector who does not lead the inspection is still refused, and it stays', async () => {
        const { h, tokenFor, apiFor, all, remaining } = await setup(1, OWNER_ID);
        try {
            const out = await deleteInspectionsViaApi(apiFor(await tokenFor(INSPECTOR_ID, 'inspector')), all);
            expect(out).toMatchObject({ ok: false, deleted: [] });
            expect(out.failed).toHaveLength(1);
            expect(await remaining()).toBe(1);
        } finally { h.close(); }
    });
});
