/**
 * Contact writes for an inspector who sees only their assigned inspections. A write that answers with
 * the row it touched must not reach a contact outside the visible set, and a duplicate-email answer
 * must not name the contact it collided with. Every restriction is paired with a control that goes through.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1Db, asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import contactRoutes from '../../../server/api/contacts';
import contactsImportRoutes from '../../../server/api/contacts/import';
import { AppError } from '../../../server/lib/errors';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const rp = (key: string) => `crp_${TENANT}_${key}`;
type Role = 'owner' | 'manager' | 'inspector';

describe('contact writes honour the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        // inspA is restricted and holds the contacts switch; inspAll holds the same switch, unrestricted.
        await db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false, manageContacts: true } }).where(eq(schema.users.id, USERS.inspA));
        await db.update(schema.users).set({ permissionOverrides: { manageContacts: true } }).where(eq(schema.users.id, USERS.inspAll));
        const archivedAt = new Date();
        await db.insert(schema.contacts).values([
            { id: 'c-own', name: 'Name own', email: 'own@example.test' },
            { id: 'c-other', name: 'Name other', email: 'other@example.test' },
            { id: 'c-mine', name: 'Name mine', email: 'mine@example.test', createdByUserId: USERS.inspA },
            { id: 'c-own-archived', name: 'Name own archived', email: null, archivedAt },
            { id: 'c-other-archived', name: 'Name other archived', email: null, archivedAt },
        ].map(r => ({ tenantId: TENANT, type: 'client' as const, createdAt: new Date(), ...r })));
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP.own, 'c-own', rp('client'));
        await people.addPerson(TENANT, INSP.other, 'c-other', rp('client'));
        await people.addPerson(TENANT, INSP.own, 'c-own-archived', rp('client'));
        await people.addPerson(TENANT, INSP.other, 'c-other-archived', rp('client'));
    });

    function build(userId: string, role: Role) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            c.set('services', { contact: new ContactService({} as D1Database) } as never);
            await next();
        });
        app.route('/api/contacts', contactRoutes);
        app.route('/api/contacts', contactsImportRoutes);
        return app;
    }
    const send = async (app: OpenAPIHono<HonoConfig>, p: string, method: string, body?: unknown) => {
        const res = await app.request(p, {
            method,
            ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        }, { DB: {}, JWT_SECRET: 'x' } as never);
        const text = await res.text();
        return { status: res.status, text };
    };
    const row = (id: string) => db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).get();
    const restricted = () => build(USERS.inspA, 'inspector');

    it('update: a contact outside the set answers 404 and is left unchanged', async () => {
        const r = await send(restricted(), '/api/contacts/c-other', 'PUT', { name: 'Hijacked' });
        expect(r.status).toBe(404);
        expect((await row('c-other'))?.name).toBe('Name other');
    });
    it('update: contacts on a visible inspection, and ones the caller made, go through (control)', async () => {
        expect((await send(restricted(), '/api/contacts/c-own', 'PUT', { name: 'Renamed' })).status).toBe(200);
        expect((await row('c-own'))?.name).toBe('Renamed');
        expect((await send(restricted(), '/api/contacts/c-mine', 'PUT', { name: 'Mine renamed' })).status).toBe(200);
    });
    it('update: an unrestricted inspector and the administrator tier reach any contact (control)', async () => {
        expect((await send(build(USERS.inspAll, 'inspector'), '/api/contacts/c-other', 'PUT', { name: 'By peer' })).status).toBe(200);
        expect((await send(build(USERS.owner, 'owner'), '/api/contacts/c-other', 'PUT', { name: 'By owner' })).status).toBe(200);
    });

    it('delete: a contact outside the set answers 404 and is not archived or removed', async () => {
        expect((await send(restricted(), '/api/contacts/c-other', 'DELETE')).status).toBe(404);
        const after = await row('c-other');
        expect(after).toBeDefined();
        expect(after?.archivedAt ?? null).toBeNull();
    });
    it('delete: a contact the caller made is removed (control)', async () => {
        expect((await send(restricted(), '/api/contacts/c-mine', 'DELETE')).status).toBe(200);
        expect(await row('c-mine')).toBeUndefined();
    });

    it('restore: an archived contact outside the set answers 404 and stays archived', async () => {
        expect((await send(restricted(), '/api/contacts/c-other-archived/restore', 'POST')).status).toBe(404);
        expect((await row('c-other-archived'))?.archivedAt).toBeTruthy();
    });
    it('restore: an archived contact on a visible inspection is restored (control)', async () => {
        const r = await send(restricted(), '/api/contacts/c-own-archived/restore', 'POST');
        expect(r.status).toBe(200);
        expect((await row('c-own-archived'))?.archivedAt ?? null).toBeNull();
    });

    it('access revoke: a contact outside the set answers 404; one inside answers 200', async () => {
        expect((await send(restricted(), '/api/contacts/c-other/access/revoke', 'POST', {})).status).toBe(404);
        expect((await send(restricted(), '/api/contacts/c-own/access/revoke', 'POST', {})).status).toBe(200);
    });

    it('create: an email that belongs to a contact outside the set is refused without naming it', async () => {
        const r = await send(restricted(), '/api/contacts', 'POST', { type: 'client', name: 'Probe', email: 'other@example.test' });
        expect(r.status).toBe(409);
        expect(r.text).not.toContain('c-other');
        expect(r.text).not.toContain('Name other');
        expect(r.text).not.toContain('other@example.test');
    });
    it('create: the same refusal for the administrator tier, so the answer does not depend on the caller (control)', async () => {
        expect((await send(build(USERS.owner, 'owner'), '/api/contacts', 'POST', { type: 'client', name: 'Dup', email: 'other@example.test' })).status).toBe(409);
    });
    it('create: a fresh email is created and the creator can read it back (control)', async () => {
        const r = await send(restricted(), '/api/contacts', 'POST', { type: 'client', name: 'Fresh', email: 'fresh@example.test' });
        expect(r.status).toBe(201);
        const id = (JSON.parse(r.text) as { data: { contact: { id: string } } }).data.contact.id;
        expect((await send(restricted(), `/api/contacts/${id}`, 'GET')).status).toBe(200);
    });

    it('import: stays with the administrator tier, so a restricted caller cannot reach the existing-contact report', async () => {
        const body = { csv: 'Name,Email\nImported,other@example.test\n', mapping: { name: 'Name', email: 'Email' } };
        expect((await send(restricted(), '/api/contacts/import', 'POST', body)).status).toBe(403);
        expect((await send(restricted(), '/api/contacts/import/preview', 'POST', { csv: body.csv })).status).toBe(403);
        expect((await send(build(USERS.owner, 'owner'), '/api/contacts/import', 'POST', body)).status).toBe(200);
    });
});
