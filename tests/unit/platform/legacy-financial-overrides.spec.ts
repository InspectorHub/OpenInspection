/**
 * Overrides stored under the retired `financial` key, through the REAL app and
 * middleware chain (in-memory SQLite, real JWT keyring, no auth mocking).
 *
 * A stored `{"financial": false}` or `{"financial": true}` reads as the same
 * value for both `inspectionFees` and `companyFinance`; an explicit new key
 * stored beside it wins. The role default must NOT silently take over.
 *
 * Every refusal is paired with an allowed control on the same route.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';

const MANAGER_ID = '22222222-0000-4000-8000-000000000003';

type Actor = 'inspector' | 'manager';

async function setup() {
    const h = await createHarness('standalone');
    await h.db.insert(schema.users).values({
        id: MANAGER_ID, tenantId: TENANT_ID, email: 'mgr@x.test', passwordHash: 'h', role: 'manager', name: 'Mona', createdAt: new Date(),
    });
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const tokens = {} as Record<Actor, string>;
    for (const [actor, sub] of [['manager', MANAGER_ID], ['inspector', INSPECTOR_ID]] as const) {
        tokens[actor] = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': actor, iat, exp: iat + 3600 }, keyring);
    }
    const call = async (actor: Actor, method: string, path: string, body?: unknown) => {
        const exec = makeExecutionContext({ label: 'legacy-financial' });
        const res = await app.request(path, {
            method,
            headers: { authorization: `Bearer ${tokens[actor]}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const store = (userId: string, overrides: unknown) =>
        h.db.update(schema.users).set({ permissionOverrides: overrides } as never).where(eq(schema.users.id, userId));
    const invoices = (actor: Actor) => call(actor, 'GET', '/api/invoices');
    const createPriced = (actor: Actor) => call(actor, 'POST', '/api/inspections', {
        propertyAddress: '9 Birch Rd', templateId: 't1', date: '2099-02-01T10:00:00Z', price: 100,
    });
    return { h, store, invoices, createPriced };
}

const refusedForMoney = async (res: Response) => {
    expect(res.status).toBe(403);
    const body = await res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('FINANCIAL_REQUIRED');
};

describe('a manager whose stored override is {"financial": false}', () => {
    it('is refused on the invoices and on a priced create, not handed the role default', async () => {
        const { h, store, invoices, createPriced } = await setup();
        try {
            // Control first: with nothing stored the same manager passes both gates.
            expect((await invoices('manager')).status).toBe(200);
            expect((await createPriced('manager')).status).not.toBe(403);

            await store(MANAGER_ID, { financial: false });
            expect((await invoices('manager')).status).toBe(403);
            await refusedForMoney(await createPriced('manager'));
        } finally { h.close(); }
    });
});

describe('an inspector whose stored override is {"financial": true}', () => {
    it('reads the invoices and may create with a price', async () => {
        const { h, store, invoices, createPriced } = await setup();
        try {
            // Control: the inspector default has no company finances.
            expect((await invoices('inspector')).status).toBe(403);

            await store(INSPECTOR_ID, { financial: true });
            expect((await invoices('inspector')).status).toBe(200);
            expect((await createPriced('inspector')).status).not.toBe(403);
        } finally { h.close(); }
    });
});

describe('a stored {"financial": false, "inspectionFees": true} on a manager', () => {
    it('refuses the invoices but still lets them create with a price', async () => {
        const { h, store, invoices, createPriced } = await setup();
        try {
            await store(MANAGER_ID, { financial: false, inspectionFees: true });
            expect((await invoices('manager')).status).toBe(403);
            expect((await createPriced('manager')).status).not.toBe(403);
        } finally { h.close(); }
    });
});

describe('the same value stored as a JSON string, as some drivers return it', () => {
    it('is read through as well', async () => {
        const { h, store, invoices } = await setup();
        try {
            await store(MANAGER_ID, '{"financial":false}');
            expect((await invoices('manager')).status).toBe(403);
        } finally { h.close(); }
    });
});
