import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { getCapabilities } from '../../../server/lib/auth/capabilities';
import { seedVisibilityFixture, TENANT, USERS } from '../helpers/visibility-fixture';
import { scopeFromCapabilities, resolveInspectionScope, ALL_INSPECTIONS } from '../../../server/lib/inspection/visibility';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('scopeFromCapabilities', () => {
    it('a restricted inspector is narrowed to their own id', () => {
        expect(scopeFromCapabilities('u', getCapabilities('inspector', { viewAllInspections: false }))).toEqual({ kind: 'assigned', userId: 'u' });
    });
    it('a default inspector, a manager and an owner see everything (positive control)', () => {
        for (const role of ['inspector', 'manager', 'owner'] as const) {
            expect(scopeFromCapabilities('u', getCapabilities(role, null))).toEqual(ALL_INSPECTIONS);
        }
    });
    it('an agent, whose capability set is all false, is narrowed (fails closed)', () => {
        expect(scopeFromCapabilities('u', getCapabilities('agent', { viewAllInspections: true }))).toEqual({ kind: 'assigned', userId: 'u' });
    });
});

describe('resolveInspectionScope', () => {
    let sdb: ScopedDB;
    let getById: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
        const f = createTestDb(); await setupSchema(f.sqlite); await seedVisibilityFixture(f.db);
        sdb = new ScopedDB(asScopedDbSource(f.db), TENANT);
        getById = vi.spyOn(sdb, 'getById');
    });

    async function scopeOf(userId: string, role: string, times = 1) {
        const app = new Hono<HonoConfig>();
        app.get('/', async (c) => {
            c.set('tenantId', TENANT);
            c.set('userRole', role as never);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('sdb', sdb);
            let scope = await resolveInspectionScope(c);
            for (let i = 1; i < times; i++) scope = await resolveInspectionScope(c);
            return c.json(scope);
        });
        return (await app.request('/')).json();
    }

    it('reads the stored restriction for a restricted inspector', async () => {
        expect(await scopeOf(USERS.inspA, 'inspector')).toEqual({ kind: 'assigned', userId: USERS.inspA });
    });
    it('an unrestricted inspector resolves to all (positive control)', async () => {
        expect(await scopeOf(USERS.inspAll, 'inspector')).toEqual({ kind: 'all' });
    });
    it('the administrator tier resolves to all without a database read', async () => {
        expect(await scopeOf(USERS.owner, 'owner')).toEqual({ kind: 'all' });
        expect(await scopeOf(USERS.manager, 'manager')).toEqual({ kind: 'all' });
        expect(getById).not.toHaveBeenCalled();
    });
    it('is resolved once per request', async () => {
        expect(await scopeOf(USERS.inspA, 'inspector', 3)).toEqual({ kind: 'assigned', userId: USERS.inspA });
        expect(getById).toHaveBeenCalledTimes(1);
    });
    it('refuses a request with no identity', async () => {
        const app = new Hono<HonoConfig>();
        app.onError((err, c) => c.json({ error: String(err) }, 500));
        app.get('/', async (c) => c.json(await resolveInspectionScope(c)));
        expect((await app.request('/')).status).toBe(500);
    });
});
