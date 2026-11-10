/**
 * Lowering a company's seat limit never removes or demotes the members it already has.
 *
 * The limit only refuses NEW seats (an invite, an acceptance, a role change onto a seat). Both ways the limit
 * arrives from the control plane (the quota sync and the tenant update) are applied here to a company with more
 * members than the new limit, and every member row, role and sign-in is compared with what it was.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { applySyncQuota, applyTenantUpdate } from '../../../server/portal/apply-commands';
import { getSeatUsage } from '../../../server/features/seat-quota';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, TENANT_ID, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';

const MEMBERS = 8;

describe('lowering max_users', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    async function seed(): Promise<Harness> {
        const created = await createHarness('saas');
        await created.db.update(schema.tenants).set({ maxUsers: MEMBERS }).where(eq(schema.tenants.id, TENANT_ID));
        const have = (await created.db.select().from(schema.users).all()).length;
        await created.db.insert(schema.users).values(Array.from({ length: MEMBERS - have }, (_, i) => ({
            id: `88888888-0000-4000-8000-00000000000${i}`, tenantId: TENANT_ID, email: `seat${i}@harbor-light.test`,
            passwordHash: 'h', role: 'manager', name: `Seat ${i}`, createdAt: new Date(),
        })) as never);
        return created;
    }

    const snapshot = async (db: Harness['db']) =>
        (await db.select({ id: schema.users.id, role: schema.users.role, deletedAt: schema.users.deletedAt, tenantId: schema.users.tenantId })
            .from(schema.users).all()).sort((a, b) => a.id.localeCompare(b.id));

    async function memberCanRead(id: string, role: string): Promise<number> {
        const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
        const iat = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: id, role, 'custom:userRole': role, 'custom:tenantId': TENANT_ID, iat, exp: iat + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'seat-limit-lowered' });
        const res = await app.request('/api/inspections', { headers: { authorization: `Bearer ${jwt}` } }, h!.env, exec.ctx);
        await exec.settle();
        return res.status;
    }

    it.each([
        ['the quota sync', async (env: Harness['env']) => {
            expect(await applySyncQuota(env.DB, env.TENANT_CACHE, { tenantId: TENANT_ID, maxUsers: 5 })).toBe('applied');
        }],
        ['the tenant update', async (env: Harness['env']) => {
            await applyTenantUpdate(env.DB, env.TENANT_CACHE, { id: TENANT_ID, slug: TENANT_SLUG, status: 'active', tier: 'free', maxUsers: 5 });
        }],
    ])('through %s keeps every member, role and sign-in', async (_name, apply) => {
        h = await seed();
        const before = await snapshot(h.db);
        expect(before.length).toBe(MEMBERS);

        await apply(h.env);

        // The change really landed: the company is now over its limit.
        const tenant = (await h.db.select().from(schema.tenants).where(eq(schema.tenants.id, TENANT_ID)).all())[0]!;
        expect(tenant.maxUsers).toBe(5);
        const seats = await getSeatUsage(TENANT_ID, h.env.DB);
        console.info(`[seat-limit-lowered] members ${seats.members} / max ${seats.max}, rows before ${before.length} after ${(await snapshot(h.db)).length}`);
        expect(seats.members).toBeGreaterThan(5);

        // And nothing about anyone changed.
        expect(await snapshot(h.db)).toEqual(before);
        const last = before[before.length - 1]!;
        expect(await memberCanRead(last.id, last.role)).toBe(200);
    }, 120_000);
});
