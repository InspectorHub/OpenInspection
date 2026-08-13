/**
 * Staff can set a contact's language, and can take it back off.
 *
 * Two things have to hold at once, and they pull in opposite directions:
 *
 *  - An update that never MENTIONS `locale` must leave a stored preference
 *    alone. `UpdateContactSchema` is `CreateContactSchema.partial()`, and zod's
 *    `.partial()` KEEPS a `.default()` — so a field with a default arrives on
 *    every request whether or not the caller sent it, and the handler writes it
 *    over whatever was there. This repo has lost label data exactly that way.
 *    The assertion below is therefore on the ABSENCE OF THE KEY in the object
 *    handed to the service, not on its value: a default of `null` would pass a
 *    value check and still be a silent overwrite of a real choice.
 *
 *  - An explicit `null` must clear it. Staff set this as a correction — the
 *    client said so on the phone, or mis-clicked on the booking form — and a
 *    correction path that cannot get back to "not stated" is not a correction
 *    path. That is why the handler tests `'locale' in raw` rather than
 *    `!== undefined`.
 *
 * And whatever is stored has to be a locale `resolveContactLocale` would hand
 * back, or NULL. A stored `fr-FR` is a promise broken at send time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import contactRoutes from '../../../server/api/contacts';
import { ContactService } from '../../../server/services/contact.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CONTACT = '00000000-0000-0000-0000-0000000000c1';

function contactsApp(services: Record<string, unknown>) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('user', { sub: 'u1' } as never);
        c.set('tenantId', TENANT);
        c.set('services', services as never);
        await next();
    });
    app.route('/api/contacts', contactRoutes);
    return app;
}

async function put(updateContact: ReturnType<typeof vi.fn>, body: unknown) {
    return contactsApp({ contact: { updateContact } }).request(
        `/api/contacts/${CONTACT}`,
        { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        {},
    );
}

describe('PUT /api/contacts/{id} — what reaches the service', () => {
    it('omits locale entirely when the caller never sent it', async () => {
        const updateContact = vi.fn().mockResolvedValue({ id: CONTACT });
        const res = await put(updateContact, { name: 'Jane' });

        expect(res.status).toBe(200);
        const data = updateContact.mock.calls[0][2] as Record<string, unknown>;
        // The key, not the value. A schema default would put `locale` here
        // holding something plausible, and the write would land.
        expect(Object.hasOwn(data, 'locale')).toBe(false);
    });

    it('passes a chosen locale through', async () => {
        const updateContact = vi.fn().mockResolvedValue({ id: CONTACT });
        const res = await put(updateContact, { name: 'Jane', locale: 'es-419' });

        expect(res.status).toBe(200);
        expect(updateContact.mock.calls[0][2]).toMatchObject({ locale: 'es-419' });
    });

    it('passes an explicit null through, so "not set" is reachable again', async () => {
        const updateContact = vi.fn().mockResolvedValue({ id: CONTACT });
        const res = await put(updateContact, { name: 'Jane', locale: null });

        expect(res.status).toBe(200);
        const data = updateContact.mock.calls[0][2] as Record<string, unknown>;
        expect(Object.hasOwn(data, 'locale')).toBe(true);
        expect(data.locale).toBeNull();
    });
});

describe('ContactService locale writes', () => {
    let svc: ContactService;
    let testDb: BetterSQLite3Database<typeof schema>;

    const storedLocale = async () =>
        (await testDb.select().from(schema.contacts).all())[0]?.locale ?? null;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values({
            id: CONTACT, tenantId: TENANT, type: 'client', name: 'Jane',
            email: 'jane@test.com', locale: 'es-419', createdAt: new Date(),
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new ContactService({} as D1Database);
    });

    it('leaves a stored preference alone when the patch does not mention it', async () => {
        await svc.updateContact(CONTACT, TENANT, { name: 'Jane Smith' });
        expect(await storedLocale()).toBe('es-419');
    });

    it('clears it on an explicit null', async () => {
        await svc.updateContact(CONTACT, TENANT, { locale: null });
        expect(await storedLocale()).toBeNull();
    });

    it('reduces a regional variant to the catalogue we have', async () => {
        await svc.updateContact(CONTACT, TENANT, { locale: 'es-MX' });
        expect(await storedLocale()).toBe('es-419');
    });

    it('stores null rather than a language we cannot speak', async () => {
        await svc.updateContact(CONTACT, TENANT, { locale: 'fr-FR' });
        expect(await storedLocale()).toBeNull();
    });

    it('normalizes on create too', async () => {
        const created = await svc.createContact(TENANT, { type: 'client', name: 'Bob', locale: 'es-MX' });
        expect(created.locale).toBe('es-419');

        const unset = await svc.createContact(TENANT, { type: 'client', name: 'Ann' });
        expect(unset.locale).toBeNull();
    });
});
