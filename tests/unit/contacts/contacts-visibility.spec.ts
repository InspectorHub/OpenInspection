import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1Db, asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import contactRoutes from '../../../server/api/contacts';
import { AppError } from '../../../server/lib/errors';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const rp = (key: string) => `crp_${TENANT}_${key}`;
const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };
const C: InspectionScope = { kind: 'assigned', userId: USERS.inspC };

/** c-own is on i-own, c-other on i-other, c-both on both; c-mine was created by inspA and is attached to nothing; c-orphan to nobody. */
const CONTACTS = ['c-own', 'c-other', 'c-both', 'c-mine', 'c-orphan'] as const;

describe('contact reads honour the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    let svc: ContactService;
    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values(CONTACTS.map(id => ({
            id, tenantId: TENANT, type: 'client' as const, name: `Name ${id}`, email: `${id}@example.test`, createdAt: new Date(),
            createdByUserId: id === 'c-mine' ? USERS.inspA : null,
        })));
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP.own, 'c-own', rp('client'));
        await people.addPerson(TENANT, INSP.other, 'c-other', rp('client'));
        await people.addPerson(TENANT, INSP.own, 'c-both', rp('client'));
        await people.addPerson(TENANT, INSP.other, 'c-both', rp('buyer_agent'));
        svc = new ContactService({} as D1Database);
    });
    const list = async (scope: InspectionScope, extra: { search?: string; type?: 'client' | 'agent' } = {}) =>
        (await svc.listContacts(TENANT, { limit: 50, offset: 0, ...extra }, scope));

    it('list: a restricted inspector sees contacts on their inspections and the ones they created', async () => {
        expect((await list(A)).map(c => c.id).sort()).toEqual(['c-both', 'c-mine', 'c-own']);
    });
    it('list: the all-scope sees every contact (positive control)', async () => {
        expect((await list(ALL_INSPECTIONS)).map(c => c.id).sort()).toEqual([...CONTACTS].sort());
    });
    it('list: counts are over visible inspections only', async () => {
        const both = (await list(A)).find(c => c.id === 'c-both')!;
        expect(both.inspectionCount).toBe(1);
        expect(both.referralCount).toBe(0); // the buyer_agent role is on i-other, which A cannot see
        const all = (await list(ALL_INSPECTIONS)).find(c => c.id === 'c-both')!;
        expect(all.inspectionCount).toBe(2);
        expect(all.referralCount).toBe(1);
    });
    it('list: a search cannot reach a contact outside the scope', async () => {
        expect(await list(A, { search: 'c-other' })).toEqual([]);
        expect((await list(A, { search: 'c-own' })).map(c => c.id)).toEqual(['c-own']);
    });
    it('list: an inspector assigned to nothing sees nothing', async () => {
        expect(await list(C)).toEqual([]);
    });
    it('detail: an outside contact answers like a missing one; an inside one is returned with history over visible inspections', async () => {
        expect(await svc.getContactDetail('c-other', TENANT, A)).toBeNull();
        expect(await svc.getContactDetail('no-such-contact', TENANT, A)).toBeNull();
        const both = await svc.getContactDetail('c-both', TENANT, A);
        expect(both?.inspections.map(i => i.id)).toEqual([INSP.own]);
        expect(both?.stats.inspectionCount).toBe(1);
        const all = await svc.getContactDetail('c-both', TENANT, ALL_INSPECTIONS);
        expect(all?.inspections.map(i => i.id).sort()).toEqual([INSP.other, INSP.own].sort());
        const mine = await svc.getContactDetail('c-mine', TENANT, A);
        expect(mine?.contact.id).toBe('c-mine');
        expect(mine?.inspections).toEqual([]);
    });
    it('access: an outside contact is null; links to inspections the caller cannot open are not listed', async () => {
        expect(await svc.listAccess('c-other', TENANT, A)).toBeNull();
        expect(await svc.listAccess('c-own', TENANT, A)).toEqual([]); // no portal access service wired: empty, not null
    });
    it('access: live links are cut to the inspections the caller can open', async () => {
        const portalAccess = {
            listLiveAccessByRecipient: async () => [
                { inspectionId: INSP.own, propertyAddress: 'a', role: 'client', createdAt: 1 },
                { inspectionId: INSP.other, propertyAddress: 'b', role: 'client', createdAt: 2 },
            ],
        } as unknown as import('../../../server/services/portal-access.service').PortalAccessService;
        const withAccess = new ContactService({} as D1Database, portalAccess);
        expect((await withAccess.listAccess('c-both', TENANT, A))?.map(a => a.inspectionId)).toEqual([INSP.own]);
        expect((await withAccess.listAccess('c-both', TENANT, ALL_INSPECTIONS))?.map(a => a.inspectionId).sort()).toEqual([INSP.other, INSP.own].sort());
    });

    describe('routes', () => {
        function build(userId: string, role: 'owner' | 'manager' | 'inspector') {
            const app = new OpenAPIHono<HonoConfig>();
            app.onError((err, c) => err instanceof AppError
                ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
                : c.json({ success: false, error: { message: String(err) } }, 500));
            app.use('*', async (c, next) => {
                c.set('userRole', role);
                c.set('user', { sub: userId, role, tenantId: TENANT } as never);
                c.set('tenantId', TENANT);
                c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
                c.set('services', { contact: svc } as never);
                await next();
            });
            app.route('/api/contacts', contactRoutes as never);
            return app;
        }
        const get = async (userId: string, role: 'owner' | 'manager' | 'inspector', p: string) => {
            const res = await build(userId, role).request(p, {}, { DB: {} });
            return { status: res.status, body: await res.json() as { data?: unknown } };
        };
        it('GET /api/contacts', async () => {
            const ids = (r: { body: { data?: unknown } }) => (r.body.data as Array<{ id: string }>).map(c => c.id).sort();
            expect(ids(await get(USERS.inspA, 'inspector', '/api/contacts?limit=50'))).toEqual(['c-both', 'c-mine', 'c-own']);
            for (const [u, r] of [[USERS.owner, 'owner'], [USERS.manager, 'manager'], [USERS.inspAll, 'inspector']] as const) {
                expect(ids(await get(u, r, '/api/contacts?limit=50'))).toEqual([...CONTACTS].sort());
            }
            expect(ids(await get(USERS.inspC, 'inspector', '/api/contacts?limit=50'))).toEqual([]);
        });
        it('GET /api/contacts/:id and /access answer an outside contact exactly like a missing one', async () => {
            for (const suffix of ['', '/access']) {
                const outside = await get(USERS.inspA, 'inspector', `/api/contacts/c-other${suffix}`);
                const missing = await get(USERS.inspA, 'inspector', `/api/contacts/no-such-contact${suffix}`);
                expect(outside.status).toBe(404);
                expect(outside).toEqual(missing);
                expect((await get(USERS.inspA, 'inspector', `/api/contacts/c-own${suffix}`)).status).toBe(200);
                expect((await get(USERS.manager, 'manager', `/api/contacts/c-other${suffix}`)).status).toBe(200);
            }
        });
    });
});
