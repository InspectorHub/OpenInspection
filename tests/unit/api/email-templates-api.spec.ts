/**
 * Email-template CRUD + preview API tests — GET/PUT/POST /api/admin/email-templates
 *
 * Route idiom copied from: server/api/secrets.ts (createApiRouter + withMcpMetadata)
 * Test setup copied from: tests/unit/admin-communication.spec.ts (OpenAPIHono + middleware mock)
 * DB layer: vi.mock('drizzle-orm/d1') → better-sqlite3 in-memory, same as email-template-service.spec.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import emailTemplateRoutes from '../../../server/api/email-templates';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT_ID);
        // Provide a minimal services stub so any middleware that reads services doesn't crash
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/admin', emailTemplateRoutes);
    return app;
}

describe('GET /api/admin/email-templates', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 'test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('returns 200 with 17 items, no password-reset, correct fields', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/email-templates', {}, { DB: {} });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Array<{ trigger: string; name: string; required: boolean; enabled: boolean; isCustomized: boolean; subject: string; category: string }> };
        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(17);
        expect(body.data.every(t => t.trigger !== 'password-reset')).toBe(true);
        for (const item of body.data) {
            expect(typeof item.trigger).toBe('string');
            expect(typeof item.name).toBe('string');
            expect(typeof item.required).toBe('boolean');
            expect(typeof item.enabled).toBe('boolean');
            expect(typeof item.isCustomized).toBe('boolean');
            expect(typeof item.subject).toBe('string');
        }
    });
});

describe('GET /api/admin/email-templates/:trigger', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 'test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('returns 200 with blocks and variables for report-ready', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/email-templates/report-ready', {}, { DB: {} });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: {
                trigger: string;
                blocks: Array<{ key: string; label: string; value: string }>;
                variables: Array<{ name: string; desc: string }>;
            }
        };
        expect(body.success).toBe(true);
        expect(body.data.trigger).toBe('report-ready');
        expect(Array.isArray(body.data.blocks)).toBe(true);
        expect(body.data.blocks.length).toBeGreaterThan(0);
        for (const block of body.data.blocks) {
            expect(typeof block.key).toBe('string');
            expect(typeof block.label).toBe('string');
            expect(typeof block.value).toBe('string');
        }
        expect(Array.isArray(body.data.variables)).toBe(true);
        expect(body.data.variables.length).toBeGreaterThan(0);
    });

    it('returns 404 for password-reset (non-editable)', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/email-templates/password-reset', {}, { DB: {} });
        expect(res.status).toBe(404);
        const body = await res.json() as { success: boolean; error: { message: string } };
        expect(body.success).toBe(false);
    });
});

describe('PUT /api/admin/email-templates/:trigger', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 'test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('saves override and follow-up GET detail shows updated subject and block value; list shows isCustomized:true', async () => {
        const app = buildApp();

        // Save the override
        const putRes = await app.request('/api/admin/email-templates/report-ready', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subject: 'X', blocks: { body: 'Y' }, enabled: true }),
        }, { DB: {} });
        expect(putRes.status).toBe(200);
        const putBody = await putRes.json() as { success: boolean; data: { ok: boolean } };
        expect(putBody.success).toBe(true);
        expect(putBody.data.ok).toBe(true);

        // Follow-up GET detail should show the saved subject and block value
        const getRes = await app.request('/api/admin/email-templates/report-ready', {}, { DB: {} });
        expect(getRes.status).toBe(200);
        const getBody = await getRes.json() as {
            success: boolean;
            data: {
                subject: string;
                blocks: Array<{ key: string; value: string }>;
            }
        };
        expect(getBody.data.subject).toBe('X');
        const bodyBlock = getBody.data.blocks.find(b => b.key === 'body');
        expect(bodyBlock?.value).toBe('Y');

        // GET list should show isCustomized:true
        const listRes = await app.request('/api/admin/email-templates', {}, { DB: {} });
        const listBody = await listRes.json() as { success: boolean; data: Array<{ trigger: string; isCustomized: boolean }> };
        const item = listBody.data.find(t => t.trigger === 'report-ready');
        expect(item?.isCustomized).toBe(true);
    });

    it('returns 400 when trying to disable a required template (evidence-pack)', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/email-templates/evidence-pack', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subject: null, blocks: null, enabled: false }),
        }, { DB: {} });
        expect(res.status).toBe(400);
        const body = await res.json() as { success: boolean; error: { message: string } };
        expect(body.success).toBe(false);
        expect(body.error.message).toContain('required');
    });

    it('returns 400 for an unknown block key', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/email-templates/report-ready', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subject: null, blocks: { nope: 'x' }, enabled: true }),
        }, { DB: {} });
        expect(res.status).toBe(400);
        const body = await res.json() as { success: boolean; error: { message: string } };
        expect(body.success).toBe(false);
        expect(body.error.message).toContain('Unknown block');
    });
});

describe('POST /api/admin/email-templates/:trigger/reset', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 'test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('resets override so GET list shows isCustomized:false', async () => {
        const app = buildApp();

        // First save an override
        await app.request('/api/admin/email-templates/report-ready', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subject: 'Custom', blocks: null, enabled: true }),
        }, { DB: {} });

        // Now reset
        const resetRes = await app.request('/api/admin/email-templates/report-ready/reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        }, { DB: {} });
        expect(resetRes.status).toBe(200);
        const resetBody = await resetRes.json() as { success: boolean; data: { ok: boolean } };
        expect(resetBody.success).toBe(true);
        expect(resetBody.data.ok).toBe(true);

        // GET list should show isCustomized:false
        const listRes = await app.request('/api/admin/email-templates', {}, { DB: {} });
        const listBody = await listRes.json() as { success: boolean; data: Array<{ trigger: string; isCustomized: boolean }> };
        const item = listBody.data.find(t => t.trigger === 'report-ready');
        expect(item?.isCustomized).toBe(false);
    });
});

describe('POST /api/admin/email-templates/:trigger/preview', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 'test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('renders preview with sample data — subject contains address, html is non-empty', async () => {
        const app = buildApp();
        const res = await app.request('/api/admin/email-templates/report-ready/preview', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subject: 'Hi {{address}}' }),
        }, { DB: {} });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { subject: string; html: string } };
        expect(body.success).toBe(true);
        // sampleDataFor maps address → '123 Main St'
        expect(body.data.subject).toContain('123 Main St');
        expect(typeof body.data.html).toBe('string');
        expect(body.data.html.length).toBeGreaterThan(0);
    });
});
