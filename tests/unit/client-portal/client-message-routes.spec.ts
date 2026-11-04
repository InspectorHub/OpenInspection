import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// MessageService + PortalAccessService both build their drizzle handle via
// `drizzle(this.db)` (drizzle-orm/d1). Mock that factory to hand back the
// in-memory better-sqlite3 test DB (mirrors client-document-routes.spec.ts).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { MessageService } from '../../../server/services/message.service';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { signPortalSession } from '../../../server/lib/portal-session';
import { createApiRouter } from '../../../server/lib/openapi-router';
import { logger } from '../../../server/lib/logger';
import { clientMessageRoutes, inspectorMessageRoutes } from '../../../server/api/messages';
import { CLIENT_MESSAGE_FIELD_LISTS } from '../../../server/lib/client-message-view';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const SECRET = 'test-jwt-secret';
const INSPECTOR_USER = 'inspector-user-1';

describe('client message routes (resolveClientActor-gated)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    function buildApp(portalAccess: PortalAccessService, message: MessageService) {
        // Parent must be an OpenAPIHono (createApiRouter) so the OpenAPIHono
        // inspector sub-router dispatches correctly when mounted via .route().
        const app = createApiRouter();
        const services = {
            portalAccess,
            message,
            // email is only invoked best-effort inside the send handler; a
            // throwing stub is swallowed by the route's try/catch.
            email: { sendMessageNotification: async () => { throw new Error('no email in test'); } },
            // portalAccess.issueToken is also used by the inspector send route to
            // build the client deep-link (best-effort, swallowed on failure).
        } as unknown as HonoConfig['Variables']['services'];
        app.use('*', async (c, next) => {
            c.set('services', services);
            await next();
        });
        // Authed inspector surface — inject the JWT context contract the global
        // jwtAuthMiddleware would set in production.
        app.use('/api/inspections/*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'inspector');
            c.set('user', { sub: INSPECTOR_USER, role: 'inspector', tenantId: TENANT } as never);
            await next();
        });
        // The production app maps an AppError to its status; this one does the same so a refusal reads as 400, not 500.
        app.onError((err, c) => c.json({ error: err.message }, ((err as { status?: number }).status ?? 500) as 400));
        app.route('/api/public', clientMessageRoutes);
        app.route('/api/inspections', inspectorMessageRoutes);
        return app;
    }

    /** An in-memory bucket: what an upload puts is what a download gets. */
    interface Held { bytes: Uint8Array; type: string; name?: string }
    const stored = new Map<string, Held>();
    const PHOTOS = {
        put: async (key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: { originalName?: string } }) => {
            stored.set(key, { bytes: value, type: opts?.httpMetadata?.contentType ?? 'application/octet-stream', ...(opts?.customMetadata?.originalName ? { name: opts.customMetadata.originalName } : {}) });
        },
        head: async (key: string) => {
            const held = stored.get(key);
            return held ? { size: held.bytes.byteLength, httpMetadata: { contentType: held.type }, customMetadata: held.name ? { originalName: held.name } : {}, uploaded: new Date(5) } : null;
        },
        get: async (key: string) => {
            const held = stored.get(key);
            return held ? { body: new Blob([new Uint8Array(held.bytes)]).stream(), httpMetadata: { contentType: held.type }, httpEtag: '"e"' } : null;
        },
    } as unknown as R2Bucket;

    function reqEnv(photos: R2Bucket = PHOTOS) {
        return { JWT_SECRET: SECRET, DB: {} as D1Database, PHOTOS: photos } as unknown as HonoConfig['Bindings'];
    }

    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const uploadForm = (name = 'quote.png') => { const fd = new FormData(); fd.append('file', new File([PNG], name, { type: 'image/png' })); fd.append('itemId', 'x'); return fd; };

    async function seed() {
        const inspectionId = 'insp1';
        // Legacy client columns are intentionally NULL — clientNameForInspection
        // / clientEmailForInspection resolve the primary client via the
        // inspection_people join (PeopleService), not these dropped columns
        // (Task 9a, people-role-profiles).
        await testDb.insert(schema.inspections).values({
            id: inspectionId, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid',
            createdAt: new Date(), price: 0,
        });
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
        await testDb.insert(schema.contacts).values({
            id: 'contact-client-1', tenantId: TENANT, type: 'client', name: 'Pat Client',
            email: 'client@x.com', phone: null, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, inspectionId, 'contact-client-1', `crp_${TENANT}_client`);

        const portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
        const clientEmail = 'client@x.com';
        const clientToken = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId, recipientEmail: clientEmail, role: 'client',
        });
        const message = new MessageService({} as D1Database);
        const app = buildApp(portalAccess, message);
        return { app, inspectionId, clientToken, clientEmail, portalAccess, message };
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    it('GET list: 401 without auth, 200 with token', async () => {
        const { app, inspectionId, clientToken } = await seed();
        const noTok = await app.request(`/api/public/inspections/${inspectionId}/messages`, {}, reqEnv());
        expect(noTok.status).toBe(401);
        const ok = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {}, reqEnv());
        expect(ok.status).toBe(200);
        const body = await ok.json<{ success: boolean; data: unknown[] }>();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST send (token): creates a client message attributed to the inspection client name', async () => {
        const { app, inspectionId, clientToken, message } = await seed();
        const res = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: 'Hello from the client' }),
        }, reqEnv());
        expect(res.status).toBe(201);
        const list = await message.listForInspection(inspectionId, TENANT);
        expect(list).toHaveLength(1);
        expect(list[0].fromRole).toBe('client');
        expect(list[0].fromName).toBe('Pat Client');
        expect(list[0].body).toBe('Hello from the client');
    });

    it('POST send: 401 without auth; 400 on empty body', async () => {
        const { app, inspectionId, clientToken } = await seed();
        const unauth = await app.request(`/api/public/inspections/${inspectionId}/messages`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'x' }),
        }, reqEnv());
        expect(unauth.status).toBe(401);
        const bad = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: '' }),
        }, reqEnv());
        expect(bad.status).toBe(400);
    });

    it('SESSION cookie path: GET list authorizes via resolveByEmailAndInspection', async () => {
        const { app, inspectionId, clientEmail } = await seed();
        const cookie = await signPortalSession(SECRET, clientEmail);
        const res = await app.request(`/api/public/inspections/${inspectionId}/messages`, {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
    });

    it('a token for a DIFFERENT inspection cannot read this inspection (resolveClientActor scoping)', async () => {
        const { app, inspectionId, portalAccess } = await seed();
        // Seed a second inspection + a token for it; that token must not read insp1.
        await testDb.insert(schema.inspections).values({
            id: 'insp2', tenantId: TENANT, propertyAddress: '2 Main St', date: '2026-06-02',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid',
            createdAt: new Date(), price: 0,
        });
        const otherToken = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId: 'insp2', recipientEmail: 'other@x.com', role: 'client',
        });
        const res = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${otherToken}`, {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('client message is visible to the inspector via the authed route, scoped by inspection', async () => {
        const { app, inspectionId, clientToken } = await seed();
        await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'ping' }),
        }, reqEnv());
        const inspRes = await app.request(`/api/inspections/${inspectionId}/messages`, {}, reqEnv());
        expect(inspRes.status).toBe(200);
        const body = await inspRes.json<{ data: { body: string }[] }>();
        expect(body.data.length).toBe(1);
        expect(body.data[0].body).toBe('ping');
    });

    describe('what the portal receives of a message', () => {
        const MESSAGE_KEYS = [...CLIENT_MESSAGE_FIELD_LISTS.message, 'attachments'].sort();

        it('POST and GET carry the listed fields, and an attachment carries no storage key', async () => {
            const { app, inspectionId, clientToken } = await seed();
            const up = await app.request(`/api/public/inspections/${inspectionId}/messages/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv());
            expect(up.status).toBe(200);
            const ATTACHMENT = (await up.json<{ data: { id: string; key: string } }>()).data;
            const sent = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ body: 'With a file', attachments: [ATTACHMENT] }),
            }, reqEnv());
            expect(sent.status).toBe(201);
            const created = (await sent.json<{ data: Record<string, unknown> }>()).data;
            expect(Object.keys(created).sort()).toEqual(MESSAGE_KEYS);
            const listed = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {}, reqEnv());
            const [row] = (await listed.json<{ data: Array<{ attachments: Array<Record<string, unknown>> } & Record<string, unknown>> }>()).data;
            expect(Object.keys(row ?? {}).sort()).toEqual(MESSAGE_KEYS);
            expect(Object.keys(row?.attachments[0] ?? {}).sort()).toEqual([...CLIENT_MESSAGE_FIELD_LISTS.attachment].sort());
            expect(JSON.stringify([created, row])).not.toContain(TENANT);
            for (const key of ['tenantId', 'contactId', 'fromUserId', 'inspectionId']) expect(row).not.toHaveProperty(key);
        });

        it("a caller with no client seat to resolve is listed nothing, while a different contact's thread exists", async () => {
            const { app, portalAccess, message } = await seed();
            // An inspection with no people on it: no seat matches and there is no primary client to fall back to.
            await testDb.insert(schema.inspections).values({
                id: 'insp2', tenantId: TENANT, propertyAddress: '2 Main St', date: '2026-06-02',
                status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', createdAt: new Date(), price: 0,
            });
            await message.createMessage({ tenantId: TENANT, inspectionId: 'insp2', contactId: 'someone-else', fromRole: 'inspector', fromName: 'Ivan', body: 'for a different contact', attachments: [] });
            expect(await message.listForInspection('insp2', TENANT)).toHaveLength(1);
            const token = await portalAccess.issueToken({ tenantId: TENANT, inspectionId: 'insp2', recipientEmail: 'nobody@x.com', role: 'client' });
            const res = await app.request(`/api/public/inspections/insp2/messages?token=${token}`, {}, reqEnv());
            expect(res.status).toBe(200);
            const { data } = await res.json<{ data: unknown[] }>();
            expect(data).toEqual([]);
        });
    });

    describe('an attachment sent with a message must be one this company uploaded for this inspection', () => {
        const send = (app: Awaited<ReturnType<typeof seed>>['app'], path: string, attachments: unknown[], headers: Record<string, string> = {}) =>
            app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ body: 'files', attachments }) }, reqEnv());
        const descriptor = (key: string, id = 'att-9') => ({ id, key, name: 'x.png', size: 1, type: 'image/png', uploadedAt: 1 });

        it('client path: an upload followed by a send is accepted and the file downloads; keys outside this company and inspection are refused', async () => {
            const { app, inspectionId, clientToken } = await seed();
            const base = `/api/public/inspections/${inspectionId}/messages`;
            const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv());
            const real = (await up.json<{ data: { id: string; key: string } & Record<string, unknown> }>()).data;
            expect(real.key).toBe(`${TENANT}/messages/${inspectionId}/${real.id}.png`);
            const ok = await send(app, `${base}?token=${clientToken}`, [real]);
            expect(ok.status).toBe(201);
            const download = await app.request(`${base}/attachments/${real.id}?token=${clientToken}`, {}, reqEnv());
            expect(download.status).toBe(200);
            expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG);
            const refused = [
                descriptor('99999999-0000-4000-8000-000000000099/messages/insp1/att-9.png'),
                descriptor(`${TENANT}/messages/insp2/att-9.png`),
                descriptor(`${TENANT}/inspections/${inspectionId}/photos/p1.jpg`),
                descriptor(`${TENANT}/messages/${inspectionId}/other-id.png`),
                descriptor(`${TENANT}/messages/${inspectionId}/att-9`),
                descriptor(`${TENANT}/messages/${inspectionId}/../insp2/att-9.png`),
                descriptor(`${TENANT}/messages/${inspectionId}/att-9.png`, 'att-9/../x'),
            ];
            for (const attachment of refused) {
                const res = await send(app, `${base}?token=${clientToken}`, [attachment]);
                expect(res.status, attachment.key).toBe(400);
            }
            // An old-shape key (the attachment id as the folder) cannot be attached again, even when the object exists.
            stored.set(`${TENANT}/messages/att-9/att-9.png`, { bytes: PNG, type: 'image/png' });
            expect((await send(app, `${base}?token=${clientToken}`, [descriptor(`${TENANT}/messages/att-9/att-9.png`)])).status).toBe(400);
            // A key in the exact upload shape whose object was never stored is refused too.
            expect((await send(app, `${base}?token=${clientToken}`, [descriptor(`${TENANT}/messages/${inspectionId}/att-9.png`)])).status).toBe(400);
            // Control: once the object exists, the same descriptor is accepted, so the refusals above are about the key and the object.
            stored.set(`${TENANT}/messages/${inspectionId}/att-9.png`, { bytes: PNG, type: 'image/png' });
            expect((await send(app, `${base}?token=${clientToken}`, [descriptor(`${TENANT}/messages/${inspectionId}/att-9.png`)])).status).toBe(201);
        });

        it('inspector path: the same rules apply to a staff send', async () => {
            const { app, inspectionId } = await seed();
            // The signed-in inspector leads the inspection, so sending is theirs to do.
            await testDb.insert(schema.users).values({ id: INSPECTOR_USER, tenantId: TENANT, email: 'ivan@x.com', passwordHash: 'h', role: 'inspector', name: 'Ivan', createdAt: new Date() });
            await testDb.update(schema.inspections).set({ inspectorId: INSPECTOR_USER }).where(eq(schema.inspections.id, inspectionId));
            const base = `/api/inspections/${inspectionId}/messages`;
            const up = await app.request(`${base}/upload`, { method: 'POST', body: uploadForm() }, reqEnv());
            expect(up.status).toBe(200);
            const real = (await up.json<{ data: { id: string; key: string } }>()).data;
            expect(real.key).toBe(`${TENANT}/messages/${inspectionId}/${real.id}.png`);
            const ok = await send(app, base, [real]);
            expect(ok.status).toBe(201);
            const refused = [
                descriptor('99999999-0000-4000-8000-000000000099/messages/insp1/att-9.png'),
                descriptor(`${TENANT}/messages/insp2/att-9.png`),
                descriptor(`${TENANT}/inspections/${inspectionId}/photos/p1.jpg`),
            ];
            for (const attachment of refused) {
                const res = await send(app, base, [attachment]);
                expect(res.status, attachment.key).toBe(400);
            }
        });

        it('rebuilds name, size and type from the stored object, whatever the send claims, and bounds the claimed fields', async () => {
            const { app, inspectionId, clientToken, message } = await seed();
            const base = `/api/public/inspections/${inspectionId}/messages`;
            const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm('quote.png') }, reqEnv());
            const real = (await up.json<{ data: { id: string; key: string } }>()).data;
            const claimed = { ...real, name: 'posted-name.html', size: 99999, type: 'text/html', uploadedAt: 1 };
            const ok = await send(app, `${base}?token=${clientToken}`, [claimed]);
            expect(ok.status).toBe(201);
            const [row] = await message.listForInspection(inspectionId, TENANT);
            expect(row?.attachments?.[0]).toMatchObject({ id: real.id, name: 'quote.png', size: PNG.byteLength, type: 'image/png' });
            const download = await app.request(`${base}/attachments/${real.id}?token=${clientToken}`, {}, reqEnv());
            expect(download.headers.get('content-type')).toBe('image/png');
            expect(download.headers.get('x-content-type-options')).toBe('nosniff');
            for (const over of [{ name: 'n'.repeat(300) }, { type: 't'.repeat(200) }, { id: 'i'.repeat(100) }, { key: `${real.key}${'k'.repeat(400)}` }]) {
                expect((await send(app, `${base}?token=${clientToken}`, [{ ...real, ...over }])).status, JSON.stringify(Object.keys(over))).toBe(400);
            }
        });

        it('serves a name in any script, with an ASCII fallback and the exact name, and never throws', async () => {
            const { app, inspectionId, clientToken } = await seed();
            const base = `/api/public/inspections/${inspectionId}/messages`;
            const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm('\u898b\u7a4d\u66f8 "quote".png') }, reqEnv());
            const real = (await up.json<{ data: { id: string; key: string } }>()).data;
            expect((await send(app, `${base}?token=${clientToken}`, [real])).status).toBe(201);
            const download = await app.request(`${base}/attachments/${real.id}?token=${clientToken}`, {}, reqEnv());
            expect(download.status).toBe(200);
            const disposition = download.headers.get('content-disposition') ?? '';
            expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
            expect(disposition).toContain(encodeURIComponent('\u898b\u7a4d\u66f8'));
            expect(disposition.split('filename="')[1]?.split('"; ')[0]).not.toContain('"');
        });

        it('keeps a name cut at 255 characters well formed when an emoji straddles the cut, and serves it', async () => {
            const { app, inspectionId, clientToken, message } = await seed();
            const base = `/api/public/inspections/${inspectionId}/messages`;
            const emoji = '\u{1F600}';
            // 254 letters, then an emoji that occupies UTF-16 units 254 and 255: a cut at 255 units would split the pair.
            const name = `${'a'.repeat(254)}${emoji}.png`;
            const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm(name) }, reqEnv());
            expect(up.status).toBe(200);
            const real = (await up.json<{ data: { id: string; key: string; name: string } }>()).data;
            expect(Array.from(real.name)).toHaveLength(255);
            expect(real.name.endsWith(emoji)).toBe(true);
            expect(stored.get(real.key)?.name).toBe(real.name);
            expect((await send(app, `${base}?token=${clientToken}`, [real])).status).toBe(201);
            const [row] = await message.listForInspection(inspectionId, TENANT);
            expect(row?.attachments?.[0]?.name).toBe(real.name);
            const download = await app.request(`${base}/attachments/${real.id}?token=${clientToken}`, {}, reqEnv());
            expect(download.status).toBe(200);
            expect(download.headers.get('content-disposition')).toContain(encodeURIComponent(emoji));
        });

        it('serves a stored name that holds an unpaired surrogate, with the replacement character in its place', async () => {
            const ctx = await seed();
            const key = `${TENANT}/messages/${ctx.inspectionId}/lone.png`;
            await ctx.message.createMessage({
                tenantId: TENANT, inspectionId: ctx.inspectionId, contactId: 'contact-client-1', fromRole: 'inspector', fromName: 'Ivan', body: 'file',
                attachments: [{ id: 'lone', key, name: 'bad\ud800name\udc00.png', size: 1, type: 'image/png', uploadedAt: 1 }],
            });
            stored.set(key, { bytes: PNG, type: 'image/png' });
            const res = await ctx.app.request(`/api/public/inspections/${ctx.inspectionId}/messages/attachments/lone?token=${ctx.clientToken}`, {}, reqEnv());
            expect(res.status).toBe(200);
            expect(res.headers.get('content-disposition')).toContain(`filename*=UTF-8''bad${encodeURIComponent('�')}name${encodeURIComponent('�')}.png`);
            // A name read back from storage with a lone surrogate is made well formed before it goes onto the message.
            const second = `${TENANT}/messages/${ctx.inspectionId}/lone2.png`;
            stored.set(second, { bytes: PNG, type: 'image/png', name: 'x\ud83dy.png' });
            const sent = await send(ctx.app, `/api/public/inspections/${ctx.inspectionId}/messages?token=${ctx.clientToken}`, [descriptor(second, 'lone2')]);
            expect(sent.status).toBe(201);
            const rows = await ctx.message.listForInspection(ctx.inspectionId, TENANT);
            expect(rows.at(-1)?.attachments?.[0]?.name).toBe('x�y.png');
        });

        it('stores a .heic file with no recognisable signature as image/heic, not as the type the client declared', async () => {
            const { app, inspectionId, clientToken } = await seed();
            const base = `/api/public/inspections/${inspectionId}/messages`;
            const fd = new FormData();
            fd.append('file', new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'photo.heic', { type: 'text/html' }));
            const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: fd }, reqEnv());
            expect(up.status).toBe(200);
            const real = (await up.json<{ data: { key: string; type: string } }>()).data;
            expect(real.type).toBe('image/heic');
            expect(stored.get(real.key)?.type).toBe('image/heic');
            // Control: a file the sniffer recognises keeps the sniffed type whatever the client declared.
            const fd2 = new FormData();
            fd2.append('file', new File([PNG], 'pic.png', { type: 'text/html' }));
            const up2 = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: fd2 }, reqEnv());
            expect((await up2.json<{ data: { type: string } }>()).data.type).toBe('image/png');
        });

        it('answers a staff send with a repeated or a missing attachment with the same neutral text, and accepts it named once', async () => {
            const { app, inspectionId } = await seed();
            await testDb.insert(schema.users).values({ id: INSPECTOR_USER, tenantId: TENANT, email: 'ivan@x.com', passwordHash: 'h', role: 'inspector', name: 'Ivan', createdAt: new Date() });
            await testDb.update(schema.inspections).set({ inspectorId: INSPECTOR_USER }).where(eq(schema.inspections.id, inspectionId));
            const base = `/api/inspections/${inspectionId}/messages`;
            const up = await app.request(`${base}/upload`, { method: 'POST', body: uploadForm() }, reqEnv());
            const real = (await up.json<{ data: { id: string; key: string } }>()).data;
            const twice = await send(app, base, [real, real]);
            expect(twice.status).toBe(400);
            expect(await twice.json()).toEqual({ error: 'Check the attachments and try again.' });
            const missing = await send(app, base, [{ ...real, key: `${real.key}-gone` }]);
            expect(missing.status).toBe(400);
            expect(await missing.json()).toEqual({ error: 'Check the attachments and try again.' });
            expect((await send(app, base, [real])).status).toBe(201);
        });

        it('refuses a send that names the same upload twice, and accepts it named once', async () => {
            const { app, inspectionId, clientToken } = await seed();
            const base = `/api/public/inspections/${inspectionId}/messages`;
            const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv());
            const real = (await up.json<{ data: { id: string; key: string } }>()).data;
            expect((await send(app, `${base}?token=${clientToken}`, [real, real])).status).toBe(400);
            expect((await send(app, `${base}?token=${clientToken}`, [real])).status).toBe(201);
        });

        describe('when storage cannot be read', () => {
            const failing = (method: 'head' | 'get' | 'put'): R2Bucket => ({
                ...PHOTOS,
                head: PHOTOS.head.bind(PHOTOS),
                get: PHOTOS.get.bind(PHOTOS),
                put: PHOTOS.put.bind(PHOTOS),
                [method]: async () => { throw new Error('R2 is down'); },
            }) as unknown as R2Bucket;

            it('answers a client send with 503 in the route error shape, and keeps a missing object a 400', async () => {
                const { app, inspectionId, clientToken } = await seed();
                const base = `/api/public/inspections/${inspectionId}/messages`;
                const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv());
                const real = (await up.json<{ data: { id: string; key: string } }>()).data;
                const post = (photos: R2Bucket, attachments: unknown[]) => app.request(`${base}?token=${clientToken}`, {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'files', attachments }),
                }, reqEnv(photos));
                const down = await post(failing('head'), [real]);
                expect(down.status).toBe(503);
                expect(await down.json()).toEqual({ error: 'Attachment storage is unavailable.' });
                // Controls: the same send succeeds with a healthy bucket, and an absent object is the sender's 400.
                expect((await post(PHOTOS, [real])).status).toBe(201);
                expect((await post(PHOTOS, [descriptor(`${TENANT}/messages/${inspectionId}/never-stored.png`, 'never-stored')])).status).toBe(400);
            });

            it('logs the storage error as the cause of a 503 and does not send it to the caller', async () => {
                const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
                try {
                    const { app, inspectionId, clientToken } = await seed();
                    const base = `/api/public/inspections/${inspectionId}/messages`;
                    const up = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv());
                    const real = (await up.json<{ data: { id: string; key: string } }>()).data;
                    const sent = await app.request(`${base}?token=${clientToken}`, {
                        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'files', attachments: [real] }),
                    }, reqEnv(failing('head')));
                    expect(sent.status).toBe(503);
                    expect(await sent.text()).not.toContain('R2 is down');
                    expect(warn).toHaveBeenCalledWith('message attachment storage failed', { op: 'head', cause: 'R2 is down' });
                    // A write that fails is the same 503 on the client upload route, with the cause logged.
                    const refused = await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv(failing('put')));
                    expect(refused.status).toBe(503);
                    expect(warn).toHaveBeenCalledWith('message attachment storage failed', { op: 'put', cause: 'R2 is down' });
                    // Control: a healthy bucket stores it.
                    expect((await app.request(`${base}/upload?token=${clientToken}`, { method: 'POST', body: uploadForm() }, reqEnv())).status).toBe(200);
                } finally {
                    warn.mockRestore();
                }
            });

            it('answers a staff send with an AppError 503 and a client download with 503 in the route error shape', async () => {
                const ctx = await seed();
                await testDb.insert(schema.users).values({ id: INSPECTOR_USER, tenantId: TENANT, email: 'ivan@x.com', passwordHash: 'h', role: 'inspector', name: 'Ivan', createdAt: new Date() });
                await testDb.update(schema.inspections).set({ inspectorId: INSPECTOR_USER }).where(eq(schema.inspections.id, ctx.inspectionId));
                const staffBase = `/api/inspections/${ctx.inspectionId}/messages`;
                const up = await ctx.app.request(`${staffBase}/upload`, { method: 'POST', body: uploadForm() }, reqEnv());
                const real = (await up.json<{ data: { id: string; key: string } }>()).data;
                const staffPost = (photos: R2Bucket, attachments: unknown[]) => ctx.app.request(staffBase, {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'files', attachments }),
                }, reqEnv(photos));
                expect((await staffPost(failing('head'), [real])).status).toBe(503);
                expect((await staffPost(PHOTOS, [real])).status).toBe(201);

                const clientDownload = (photos: R2Bucket, id: string) =>
                    ctx.app.request(`/api/public/inspections/${ctx.inspectionId}/messages/attachments/${id}?token=${ctx.clientToken}`, {}, reqEnv(photos));
                const staffDownload = (photos: R2Bucket, id: string) => ctx.app.request(`${staffBase}/attachments/${id}`, {}, reqEnv(photos));
                const broken = await clientDownload(failing('get'), real.id);
                expect(broken.status).toBe(503);
                expect(await broken.json()).toEqual({ error: 'Attachment storage is unavailable.' });
                expect((await staffDownload(failing('get'), real.id)).status).toBe(503);
                // Controls: healthy storage serves it, and an unknown attachment stays a 404.
                expect((await clientDownload(PHOTOS, real.id)).status).toBe(200);
                expect((await staffDownload(PHOTOS, real.id)).status).toBe(200);
                expect((await clientDownload(PHOTOS, 'no-such-attachment')).status).toBe(404);
            });
        });

        describe('a download is served only from this company message folder, and only from the caller thread', () => {
            type Ctx = Awaited<ReturnType<typeof seed>>;
            const seedMessage = async (ctx: Ctx, key: string, attachmentId: string, contactId: string) => {
                await ctx.message.createMessage({
                    tenantId: TENANT, inspectionId: ctx.inspectionId, contactId, fromRole: 'inspector', fromName: 'Ivan', body: 'file',
                    attachments: [{ id: attachmentId, key, name: 'x.png', size: 1, type: 'image/png', uploadedAt: 1 }],
                });
                stored.set(key, { bytes: PNG, type: 'image/png' });
            };
            const fetchBoth = async (ctx: Awaited<ReturnType<typeof seed>>, attachmentId: string) => {
                const client = await ctx.app.request(`/api/public/inspections/${ctx.inspectionId}/messages/attachments/${attachmentId}?token=${ctx.clientToken}`, {}, reqEnv());
                const staff = await ctx.app.request(`/api/inspections/${ctx.inspectionId}/messages/attachments/${attachmentId}`, {}, reqEnv());
                return { client: client.status, staff: staff.status };
            };

            it('refuses a stored key that names another company or a photo, and serves an old-shape key of the company', async () => {
                const ctx = await seed();
                await seedMessage(ctx, '99999999-0000-4000-8000-000000000099/messages/m/a.png', 'a-foreign', 'contact-client-1');
                expect(await fetchBoth(ctx, 'a-foreign')).toEqual({ client: 404, staff: 404 });
                await seedMessage(ctx, `${TENANT}/inspections/insp1/photos/p1.jpg`, 'a-photo', 'contact-client-1');
                expect(await fetchBoth(ctx, 'a-photo')).toEqual({ client: 404, staff: 404 });
                await seedMessage(ctx, `${TENANT}/messages/a-old/a-old.png`, 'a-old', 'contact-client-1');
                expect(await fetchBoth(ctx, 'a-old')).toEqual({ client: 200, staff: 200 });
            });

            it("does not hand a client the attachment of a different contact's thread, and does hand over their own", async () => {
                const ctx = await seed();
                await seedMessage(ctx, `${TENANT}/messages/insp1/a-other.png`, 'a-other', 'contact-someone-else');
                expect(await fetchBoth(ctx, 'a-other')).toEqual({ client: 404, staff: 200 });
                await seedMessage(ctx, `${TENANT}/messages/insp1/a-own.png`, 'a-own', 'contact-client-1');
                expect(await fetchBoth(ctx, 'a-own')).toEqual({ client: 200, staff: 200 });
            });
        });
    });
});
