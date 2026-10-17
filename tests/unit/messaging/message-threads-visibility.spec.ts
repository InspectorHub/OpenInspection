import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1Db, asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { MessageService } from '../../../server/services/message.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { messageThreadRoutes } from '../../../server/api/messages-threads';
import { AppError } from '../../../server/lib/errors';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const rp = (key: string) => `crp_${TENANT}_${key}`;
const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };

/**
 * c-both has a message on i-own and one on i-other, plus an outreach line (no inspection) written
 * by inspB. c-other-only has a single message on i-other. c-new is on nothing.
 */
describe('message threads honour the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    let svc: MessageService;
    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values(['c-both', 'c-other-only', 'c-new'].map(id => ({
            id, tenantId: TENANT, type: 'client' as const, name: `Name ${id}`, email: `${id}@example.test`, createdAt: new Date(),
        })));
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP.own, 'c-both', rp('client'));
        await people.addPerson(TENANT, INSP.other, 'c-both', rp('buyer_agent'));
        await people.addPerson(TENANT, INSP.other, 'c-other-only', rp('client'));
        const msg = (id: string, inspectionId: string | null, contactId: string, fromRole: 'client' | 'inspector', at: number, fromUserId: string | null = null) => ({
            id, tenantId: TENANT, inspectionId, contactId, fromRole, fromName: 'x', body: id, attachments: [], readAt: null, createdAt: new Date(at), fromUserId,
        });
        await db.insert(schema.inspectionMessages).values([
            msg('m-own', INSP.own, 'c-both', 'client', 1000),
            msg('m-other', INSP.other, 'c-both', 'client', 2000),
            msg('m-outreach-b', null, 'c-both', 'inspector', 3000, USERS.inspB),
            msg('m-outreach-a', null, 'c-both', 'inspector', 1500, USERS.inspA),
            msg('m-other-only', INSP.other, 'c-other-only', 'client', 4000),
        ]);
        svc = new MessageService({} as D1Database);
    });

    it('threads: only conversations with something visible, summarised over the visible rows', async () => {
        const threads = await svc.listThreads(TENANT, A);
        expect(threads.map(t => t.contactId)).toEqual(['c-both']);
        const both = threads[0]!;
        expect(both.unread).toBe(1); // m-own only; m-other is not theirs to count
        expect(both.lastBody).toBe('m-outreach-a'); // their own outreach is newer than m-own; the other inspector's is not visible
    });
    it('threads: the all-scope sees everything (positive control)', async () => {
        const threads = await svc.listThreads(TENANT, ALL_INSPECTIONS);
        expect(threads.map(t => t.contactId).sort()).toEqual(['c-both', 'c-other-only']);
        expect(threads.find(t => t.contactId === 'c-both')!.unread).toBe(2);
    });
    it('thread: only the visible rows come back', async () => {
        const rows = await svc.listThreadForContact(TENANT, 'c-both', A);
        expect(rows.map(r => r.id).sort()).toEqual(['m-outreach-a', 'm-own']);
        expect((await svc.listThreadForContact(TENANT, 'c-both', ALL_INSPECTIONS)).length).toBe(4);
    });
    it('mark read: clears only the rows the caller could read', async () => {
        await svc.markContactThreadReadForStaff(TENANT, 'c-both', A);
        const read = async (id: string) => (await db.select({ r: schema.inspectionMessages.readAt }).from(schema.inspectionMessages).where(eq(schema.inspectionMessages.id, id)).get())?.r;
        expect(await read('m-own')).not.toBeNull();
        expect(await read('m-other')).toBeNull(); // still unread for the people who can see it
    });
    it('unread count: the same rows as the threads', async () => {
        expect(await svc.unreadCountForTenant(TENANT, A)).toBe(1);
        expect(await svc.unreadCountForTenant(TENANT, ALL_INSPECTIONS)).toBe(3);
        expect(await svc.unreadCountForTenant(TENANT, { kind: 'assigned', userId: USERS.inspC })).toBe(0);
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
                c.set('services', { message: svc, email: { sendMessageNotification: async () => {}, sendContactMessageNotification: async () => {} } } as never);
                await next();
            });
            app.route('/api/messages', messageThreadRoutes as never);
            return app;
        }
        const call = async (userId: string, role: 'owner' | 'manager' | 'inspector', p: string, init?: RequestInit) => {
            const res = await build(userId, role).request(p, init, { DB: {} });
            return { status: res.status, body: await res.json() as { data?: unknown } };
        };

        it('GET /threads', async () => {
            const ids = (r: { body: { data?: unknown } }) => (r.body.data as Array<{ contactId: string }>).map(t => t.contactId).sort();
            expect(ids(await call(USERS.inspA, 'inspector', '/api/messages/threads'))).toEqual(['c-both']);
            expect(ids(await call(USERS.manager, 'manager', '/api/messages/threads'))).toEqual(['c-both', 'c-other-only']);
        });
        it('GET /threads/:contactId: a contact outside the scope answers like a missing one; an inside one shows visible rows only', async () => {
            const outside = await call(USERS.inspA, 'inspector', '/api/messages/threads/c-other-only');
            const missing = await call(USERS.inspA, 'inspector', '/api/messages/threads/no-such-contact');
            expect(outside.status).toBe(404);
            expect(outside).toEqual(missing);
            const inside = await call(USERS.inspA, 'inspector', '/api/messages/threads/c-both');
            expect(inside.status).toBe(200);
            const messages = (inside.body.data as { messages: Array<{ id: string }> }).messages;
            expect(messages.map(m => m.id).sort()).toEqual(['m-outreach-a', 'm-own']);
            expect((await call(USERS.manager, 'manager', '/api/messages/threads/c-other-only')).status).toBe(200);
        });
        it('POST /threads/:contactId: a hidden mention is not found, and nothing is stored', async () => {
            const post = (inspectionId: string | undefined) => call(USERS.inspA, 'inspector', '/api/messages/threads/c-both', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hi', ...(inspectionId ? { inspectionId } : {}) }),
            });
            const before = (await db.select().from(schema.inspectionMessages).all()).length;
            const hidden = await post(INSP.other);
            expect(hidden.status).toBe(404);
            expect((await db.select().from(schema.inspectionMessages).all()).length).toBe(before);
            // control: a visible mention goes through
            expect((await post(INSP.own)).status).toBe(201);
            // a contact outside the scope is not found even without a mention
            const outsideContact = await call(USERS.inspA, 'inspector', '/api/messages/threads/c-other-only', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hi' }),
            });
            expect(outsideContact.status).toBe(404);
        });
    });
});
