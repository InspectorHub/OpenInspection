/**
 * DELETE /api/availability/overrides/:id through the REAL app and middleware
 * chain (in-memory SQLite, real JWT keyring), standalone mode.
 *
 * Rules pinned here, each with a control that proves the refusal is the rule and
 * not a broken fixture:
 *   - an owner or manager may delete any manual override; an inspector only a row
 *     of their own (the same rule as creating one);
 *   - a row synced from a calendar (source google / apple) is managed by the
 *     calendar connection and is refused with 409;
 *   - another company's row is not found;
 *   - a delete is written to the audit log with non-sensitive facts only.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';

const OTHER_ID = '22222222-0000-4000-8000-000000000004';
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
const FOREIGN_USER = '22222222-0000-4000-8000-0000000000ff';
const ROWS = {
    mineManual: '66666666-0000-4000-8000-000000000001',
    mineExtra: '66666666-0000-4000-8000-000000000002',
    theirs: '66666666-0000-4000-8000-000000000003',
    synced: '66666666-0000-4000-8000-000000000004',
    foreign: '66666666-0000-4000-8000-000000000005',
};
type Actor = 'owner' | 'inspector';

async function setup() {
    const h = await createHarness('standalone');
    const now = new Date();
    await h.db.insert(schema.users).values([
        { id: OTHER_ID, tenantId: TENANT_ID, email: 'ines@x.test', passwordHash: 'h', role: 'inspector', name: 'Ines', createdAt: now },
    ]);
    await h.db.insert(schema.tenants).values({ id: OTHER_TENANT, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now } as never);
    await h.db.insert(schema.users).values({ id: FOREIGN_USER, tenantId: OTHER_TENANT, email: 'o@other.test', passwordHash: 'h', role: 'inspector', name: 'Oto', createdAt: now });
    const base = { tenantId: TENANT_ID, isAvailable: false, startTime: null, endTime: null, createdAt: now };
    await h.db.insert(schema.availabilityOverrides).values([
        { ...base, id: ROWS.mineManual, inspectorId: INSPECTOR_ID, date: '2026-12-24' },
        { ...base, id: ROWS.mineExtra, inspectorId: INSPECTOR_ID, date: '2026-12-26', isAvailable: true, startTime: '09:00', endTime: '12:00' },
        { ...base, id: ROWS.theirs, inspectorId: OTHER_ID, date: '2026-12-24' },
        { ...base, id: ROWS.synced, inspectorId: INSPECTOR_ID, date: '2026-12-30', source: 'google', externalId: 'ev-1', startTime: '10:00', endTime: '11:00' },
        { ...base, id: ROWS.foreign, tenantId: OTHER_TENANT, inspectorId: FOREIGN_USER, date: '2026-12-24' },
    ] as never);
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const tokens = {} as Record<Actor, string>;
    for (const [actor, sub] of [['owner', OWNER_ID], ['inspector', INSPECTOR_ID]] as const) {
        tokens[actor] = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': actor, iat, exp: iat + 3600 }, keyring);
    }
    const del = async (actor: Actor, id: string) => {
        const exec = makeExecutionContext({ label: 'delete-override' });
        const res = await app.request(`/api/availability/overrides/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokens[actor]}` } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const exists = async (id: string) => !!(await h.db.select({ id: schema.availabilityOverrides.id }).from(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.id, id)).get());
    const audits = () => h.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'availability.override.delete')).all();
    return { h, del, exists, audits };
}

describe('deleting a date override', () => {
    it('an owner deletes a manual whole-day block, and the audit row records date, kind and inspector only', async () => {
        const { h, del, exists, audits } = await setup();
        try {
            expect((await del('owner', ROWS.mineManual)).status).toBe(200);
            expect(await exists(ROWS.mineManual)).toBe(false);
            const rows = await audits();
            expect(rows).toHaveLength(1);
            expect(rows[0]!.metadata).toEqual({ date: '2026-12-24', kind: 'manual', inspectorId: INSPECTOR_ID });
            expect(JSON.stringify(rows[0]!.metadata)).not.toMatch(/@/);
        } finally { h.close(); }
    });

    it('an extra-hours row is recorded as such', async () => {
        const { h, del, audits } = await setup();
        try {
            expect((await del('owner', ROWS.mineExtra)).status).toBe(200);
            expect((await audits())[0]!.metadata).toMatchObject({ kind: 'extra-hours', date: '2026-12-26' });
        } finally { h.close(); }
    });

    it('an inspector deletes their own row (control)', async () => {
        const { h, del, exists } = await setup();
        try {
            expect((await del('inspector', ROWS.mineManual)).status).toBe(200);
            expect(await exists(ROWS.mineManual)).toBe(false);
        } finally { h.close(); }
    });

    it('an inspector cannot delete a colleague row: 403, the row stays, nothing is audited', async () => {
        const { h, del, exists, audits } = await setup();
        try {
            expect((await del('inspector', ROWS.theirs)).status).toBe(403);
            expect(await exists(ROWS.theirs)).toBe(true);
            expect(await audits()).toHaveLength(0);
        } finally { h.close(); }
    });

    it('a row synced from a calendar is refused with 409 for everyone, and stays', async () => {
        const { h, del, exists } = await setup();
        try {
            for (const actor of ['owner', 'inspector'] as const) {
                const res = await del(actor, ROWS.synced);
                expect(res.status).toBe(409);
                expect(JSON.stringify(await res.json())).toMatch(/calendar/i);
            }
            expect(await exists(ROWS.synced)).toBe(true);
        } finally { h.close(); }
    });

    it('another company row is not found, and stays (tenant scoping)', async () => {
        const { h, del, exists } = await setup();
        try {
            expect((await del('owner', ROWS.foreign)).status).toBe(404);
            expect(await exists(ROWS.foreign)).toBe(true);
        } finally { h.close(); }
    });

    it('an unknown id is not found', async () => {
        const { h, del } = await setup();
        try {
            expect((await del('owner', '66666666-0000-4000-8000-0000000000aa')).status).toBe(404);
        } finally { h.close(); }
    });
});
