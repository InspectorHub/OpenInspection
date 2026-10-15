/**
 * Deleting an inspection through the REAL app and middleware chain (in-memory
 * SQLite, real JWT keyring, no auth mocking), standalone mode.
 *
 * Two independent rules and both are pinned:
 *   - the `deleteInspection` capability (on by default for owner, manager and
 *     inspector; a manager or inspector override can turn it off; owner cannot be
 *     reduced), and
 *   - the roster rule that was already there (an inspector deletes only an
 *     inspection they lead).
 *
 * Every refusal is paired with an allowed control, and a refusal always asserts
 * that the row is still there.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';

const MANAGER_ID = '22222222-0000-4000-8000-000000000003';
const OTHER_ID = '22222222-0000-4000-8000-000000000004';
const THEIRS = '44444444-0000-4000-8000-000000000001'; // led by OTHER_ID
const MINE = '44444444-0000-4000-8000-000000000002'; // led by INSPECTOR_ID
const MINE_TOO = '44444444-0000-4000-8000-000000000003'; // led by INSPECTOR_ID

type Actor = 'inspector' | 'manager' | 'owner';

async function setup() {
    const h = await createHarness('standalone');
    const now = new Date();
    (h.env as unknown as Record<string, unknown>).PHOTOS = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined };
    await h.db.insert(schema.users).values([
        { id: MANAGER_ID, tenantId: TENANT_ID, email: 'mgr@x.test', passwordHash: 'h', role: 'manager', name: 'Mona', createdAt: now },
        { id: OTHER_ID, tenantId: TENANT_ID, email: 'ines@x.test', passwordHash: 'h', role: 'inspector', name: 'Ines', createdAt: now },
    ]);
    const base = {
        tenantId: TENANT_ID, propertyAddress: '99 Secret Lane', date: '2026-06-01', status: 'completed',
        paymentStatus: 'unpaid', price: 1000, agreementRequired: false, paymentRequired: false, createdAt: now,
    };
    await h.db.insert(schema.inspections).values([
        { ...base, id: THEIRS, inspectorId: OTHER_ID, reportStatus: 'published' },
        { ...base, id: MINE, inspectorId: INSPECTOR_ID, reportStatus: 'published' },
        { ...base, id: MINE_TOO, inspectorId: INSPECTOR_ID, reportStatus: 'in_progress' },
    ] as never);
    await h.db.insert(schema.inspectionInspectors).values([
        { inspectionId: THEIRS, userId: OTHER_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
        { inspectionId: MINE, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
        { inspectionId: MINE_TOO, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
    ]);
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const tokens = {} as Record<Actor, string>;
    for (const [actor, sub] of [['owner', OWNER_ID], ['manager', MANAGER_ID], ['inspector', INSPECTOR_ID]] as const) {
        tokens[actor] = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': actor, iat, exp: iat + 3600 }, keyring);
    }
    const del = async (actor: Actor, id: string) => {
        const exec = makeExecutionContext({ label: 'delete' });
        const res = await app.request(`/api/inspections/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokens[actor]}` } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const exists = async (id: string) =>
        !!(await h.db.select({ id: schema.inspections.id }).from(schema.inspections).where(eq(schema.inspections.id, id)).get());
    const setOverrides = (userId: string, overrides: Record<string, boolean>) =>
        h.db.update(schema.users).set({ permissionOverrides: overrides } as never).where(eq(schema.users.id, userId));
    return { h, del, exists, setOverrides };
}

describe('deleting an inspection: the deleteInspection capability', () => {
    it('an inspector deletes one they lead by default, and the row goes', async () => {
        const { h, del, exists } = await setup();
        try {
            expect((await del('inspector', MINE)).status).toBe(200);
            expect(await exists(MINE)).toBe(false);
        } finally { h.close(); }
    });

    it('an inspector cannot delete one someone else leads (the roster rule still holds)', async () => {
        const { h, del, exists } = await setup();
        try {
            expect((await del('inspector', THEIRS)).status).toBe(403);
            expect(await exists(THEIRS)).toBe(true);
        } finally { h.close(); }
    });

    it('turning the capability off stops an inspector deleting even their own, and only theirs', async () => {
        const { h, del, exists, setOverrides } = await setup();
        try {
            await setOverrides(INSPECTOR_ID, { deleteInspection: false });
            expect((await del('inspector', MINE)).status).toBe(403);
            expect(await exists(MINE)).toBe(true);
            // Control: the override belongs to one person, not the role.
            expect((await del('manager', MINE)).status).toBe(200);
            expect(await exists(MINE)).toBe(false);
        } finally { h.close(); }
    });

    it('a manager deletes any inspection, until their capability is turned off', async () => {
        const { h, del, exists, setOverrides } = await setup();
        try {
            expect((await del('manager', THEIRS)).status).toBe(200);
            expect(await exists(THEIRS)).toBe(false);
            await setOverrides(MANAGER_ID, { deleteInspection: false });
            expect((await del('manager', MINE_TOO)).status).toBe(403);
            expect(await exists(MINE_TOO)).toBe(true);
        } finally { h.close(); }
    });

    it('an owner cannot be reduced by an override', async () => {
        const { h, del, exists, setOverrides } = await setup();
        try {
            await setOverrides(OWNER_ID, { deleteInspection: false });
            expect((await del('owner', THEIRS)).status).toBe(200);
            expect(await exists(THEIRS)).toBe(false);
        } finally { h.close(); }
    });

    it('the audit record says what was deleted without copying personal details', async () => {
        const { h, del } = await setup();
        try {
            expect((await del('owner', MINE)).status).toBe(200);
            const rows = await h.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'inspection.delete')).all();
            expect(rows).toHaveLength(1);
            const meta = rows[0]!.metadata as Record<string, unknown>;
            expect(meta).toMatchObject({ status: 'completed', reportPublished: true, hadInvoice: false });
            expect(JSON.stringify(meta)).not.toMatch(/@/);
        } finally { h.close(); }
    });
});
