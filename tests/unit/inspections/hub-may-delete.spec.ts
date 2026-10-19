/**
 * The hub says whether THIS viewer may delete THIS inspection, decided by the rule the delete
 * route enforces (the `deleteInspection` capability, and being the lead or holding `scheduleOthers`),
 * so the page never offers a Delete the API would refuse. Real app, real middleware and JWT.
 * The route stays the authority: a stale page that sends the delete anyway still gets the 403.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';

const INSPECTION = '66666666-0000-4000-8000-000000000001';
const OTHER_INSPECTOR = '22222222-0000-4000-8000-0000000000a1';
const MANAGER = '22222222-0000-4000-8000-0000000000a2';
const STAFF = '22222222-0000-4000-8000-0000000000a3';

async function setup() {
    const h = await createHarness('standalone');
    const now = new Date();
    const person = (id: string, role: string) => ({ id, tenantId: TENANT_ID, email: `${id}@x.test`, passwordHash: 'h', role, name: id, createdAt: now });
    await h.db.insert(schema.users).values([person(OTHER_INSPECTOR, 'inspector'), person(MANAGER, 'manager'), person(STAFF, 'staff')] as never);
    await h.db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT_ID, propertyAddress: '1 Lead Road', date: '2026-06-01', status: 'scheduled', paymentStatus: 'unpaid',
        price: 0, agreementRequired: false, paymentRequired: false, inspectorId: INSPECTOR_ID, createdAt: now,
    } as never);
    await h.db.insert(schema.inspectionInspectors).values({ inspectionId: INSPECTION, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now });
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const hub = async (sub: string, role: string) => {
        const token = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': role, iat, exp: iat + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'hub' });
        const res = await app.request(`/api/inspections/${INSPECTION}/hub`, { headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        return { status: res.status, body: (await res.json()) as { data?: { lifecycle?: { mayDelete?: boolean } } } };
    };
    const del = async (sub: string, role: string) => {
        const token = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': role, iat, exp: iat + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'del' });
        (h.env as unknown as Record<string, unknown>).PHOTOS = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined };
        const res = await app.request(`/api/inspections/${INSPECTION}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        return res.status;
    };
    return { h, hub, del };
}

describe('hub lifecycle.mayDelete', () => {
    it.each([
        ['the lead inspector', INSPECTOR_ID, 'inspector', true],
        ['the owner', OWNER_ID, 'owner', true],
        ['a manager (scheduleOthers by default)', MANAGER, 'manager', true],
        ['an inspector who is not the lead', OTHER_INSPECTOR, 'inspector', false],
        ['office staff', STAFF, 'staff', false],
    ])('%s: %s', async (_name, sub, role, expected) => {
        const { h, hub } = await setup();
        try {
            const out = await hub(sub, role);
            expect(out.status).toBe(200);
            expect(out.body.data?.lifecycle?.mayDelete).toBe(expected);
        } finally { h.close(); }
    });

    it('the delete route stays the authority: a non-lead inspector who sends it anyway is refused 403, the lead is not', async () => {
        const { h, del } = await setup();
        try {
            expect(await del(OTHER_INSPECTOR, 'inspector')).toBe(403);
            expect(await del(OTHER_INSPECTOR, 'inspector')).toBe(403);
            expect(await del(INSPECTOR_ID, 'inspector')).toBe(200);
        } finally { h.close(); }
    });
});
