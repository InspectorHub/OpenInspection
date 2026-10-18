/**
 * An update that never names `type` must leave it alone.
 *
 * `UpdateContactSchema` used to be `CreateContactSchema.partial()`, and zod's
 * `.partial()` KEEPS a `.default()`. `type` carried `.default('client')`, so
 * every PUT arrived with `type: 'client'` whether or not the caller sent it,
 * and clearing an agent's phone silently turned the agent into a client.
 *
 * The assertions on the schema are on the ABSENCE OF THE KEY, not on a value:
 * a default that happened to equal the stored value would pass a value check
 * and still be a silent overwrite waiting for the next stored value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import contactRoutes from '../../../server/api/contacts';
import { ContactService } from '../../../server/services/contact.service';
import { CreateContactSchema, UpdateContactSchema } from '../../../server/lib/validations/contact.schema';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const AGENT = '00000000-0000-0000-0000-0000000000a1';

describe('UpdateContactSchema carries no create-time default', () => {
    it('parses an empty body to an object with no keys', () => {
        const parsed = UpdateContactSchema.parse({});
        expect(Object.keys(parsed)).toEqual([]);
    });

    it.each([{ email: null }, { phone: null }, { agency: null }, { notes: null }, { name: 'Jane' }])(
        'does not add `type` to %j', (body) => {
            const parsed = UpdateContactSchema.parse(body);
            expect(Object.hasOwn(parsed, 'type')).toBe(false);
        },
    );

    it('still accepts an explicit type', () => {
        expect(UpdateContactSchema.parse({ type: 'other' })).toEqual({ type: 'other' });
    });

    it('positive control: create still defaults the type to client', () => {
        expect(CreateContactSchema.parse({ name: 'Jane' }).type).toBe('client');
    });
});

describe('PUT /api/contacts/{id} keeps the stored type', () => {
    let db: BetterSQLite3Database<typeof schema>;

    function app() {
        const a = new OpenAPIHono<HonoConfig>();
        a.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('user', { sub: 'u1' } as never);
            c.set('tenantId', TENANT);
            c.set('services', { contact: new ContactService({} as D1Database) } as never);
            await next();
        });
        a.route('/api/contacts', contactRoutes);
        return a;
    }

    const put = (body: unknown) => app().request(
        `/api/contacts/${AGENT}`,
        { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        {},
    );
    const stored = async () => (await db.select().from(schema.contacts).where(eq(schema.contacts.id, AGENT)).get())!;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.contacts).values({
            id: AGENT, tenantId: TENANT, type: 'agent', name: 'Ann Agent',
            email: 'ann@realty.test', phone: '555-0100', createdAt: new Date(),
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    it.each([{ email: null }, { phone: null }])('an agent stays an agent when %j is sent', async (body) => {
        const res = await put(body);
        expect(res.status).toBe(200);
        const json = (await res.json()) as { data: { contact: { type: string } } };
        expect(json.data.contact.type).toBe('agent');
        expect((await stored()).type).toBe('agent');
    });

    it('clearing the phone really clears it (the write itself still lands)', async () => {
        await put({ phone: null });
        expect((await stored()).phone).toBeNull();
    });

    it('the agent email stays frozen when the email is edited, and type is untouched', async () => {
        const res = await put({ email: 'someone-else@realty.test', phone: '555-0199' });
        expect(res.status).toBe(200);
        const row = await stored();
        expect(row.email).toBe('ann@realty.test');
        expect(row.phone).toBe('555-0199');
        expect(row.type).toBe('agent');
    });

    it('an explicit type change is still honoured', async () => {
        await put({ type: 'other' });
        expect((await stored()).type).toBe('other');
    });
});
