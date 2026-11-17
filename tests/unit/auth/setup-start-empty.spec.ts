/**
 * POST /api/auth/setup with and without `startEmpty`, through the real route
 * and the real first-run provider over an in-memory database.
 *
 * What is pinned: an empty start writes an owner and no bundled content and
 * leaves a stamp the content sweep respects; the default path is unchanged;
 * an initialised workspace still answers 409.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { tenants, users, templates, comments, eventTypes } from '../../../server/lib/db/schema';
import { StandaloneProvider } from '../../../server/lib/integration/standalone';
import { NO_STARTER_CONTENT } from '../../../server/services/starter-content/content-version';
import coreAuthRoutes from '../../../server/api/auth';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('../../../server/lib/jwt-keyring', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../server/lib/jwt-keyring')>(),
    signJwt: async () => 'test.jwt.token',
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const CODE = 'setup-code-123';
const body = (extra: Record<string, boolean> = {}) => ({
    companyName: 'Acme Inspections', adminName: 'Mike Reynolds', email: 'owner@example.com',
    password: 'P@ssword123', verificationCode: CODE, ...extra,
});

let db: BetterSQLite3Database<typeof schema>;
let binding: D1Database;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    binding = toD1Binding(fix.sqlite);
    await setupSchema(fix.sqlite);
});

function post(payload: object) {
    const provider = new StandaloneProvider(binding);
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('services', {
            auth: { hashPassword: async () => 'pbkdf2:x:y' },
            admin: { updateTenantStatus: (p: Parameters<typeof provider.handleTenantUpdate>[0]) => provider.handleTenantUpdate(p) },
        } as unknown as HonoConfig['Variables']['services']);
        c.set('keyringPromise', Promise.resolve({}) as unknown as HonoConfig['Variables']['keyringPromise']);
        await next();
    });
    app.route('/api/auth', coreAuthRoutes);
    return app.request('/api/auth/setup', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }, { DB: binding, SETUP_CODE: CODE } as unknown as HonoConfig['Bindings']);
}
const count = (table: typeof templates | typeof comments | typeof eventTypes) => db.select().from(table).all().length;

describe('POST /api/auth/setup', () => {
    it('startEmpty: creates the owner, writes no bundled content and stamps the workspace', async () => {
        const res = await post(body({ startEmpty: true }));
        expect(res.status).toBe(200);
        expect(db.select().from(users).all()).toHaveLength(1);
        expect(count(templates)).toBe(0);
        expect(count(comments)).toBe(0);
        expect(count(eventTypes)).toBe(0);
        expect(db.select().from(tenants).all()[0]?.contentVersion).toBe(NO_STARTER_CONTENT);
        expect(res.headers.get('set-cookie')).toContain('test.jwt.token');
    });

    it('CONTROL - without startEmpty the full library is seeded and the workspace is not stamped', async () => {
        const res = await post(body());
        expect(res.status).toBe(200);
        expect(count(templates)).toBeGreaterThan(1);
        expect(count(comments)).toBeGreaterThan(8);
        expect(count(eventTypes)).toBeGreaterThan(0);
        expect(db.select().from(tenants).all()[0]?.contentVersion).toBeNull();
    });

    it('startEmpty: false behaves as the default', async () => {
        const res = await post(body({ startEmpty: false }));
        expect(res.status).toBe(200);
        expect(count(templates)).toBeGreaterThan(1);
    });

    it('answers 409 once initialised, with or without startEmpty, and writes nothing more', async () => {
        await post(body({ startEmpty: true }));
        const before = count(templates);
        const extras: Record<string, boolean>[] = [{}, { startEmpty: true }];
        for (const extra of extras) {
            const res = await post({ ...body(extra), email: 'second@example.com' });
            expect(res.status).toBe(409);
        }
        expect(count(templates)).toBe(before);
        expect(db.select().from(users).all()).toHaveLength(1);
    });

    it.each(['yes', 'true', 'false', '0', '1'])('rejects the string %j as startEmpty and writes nothing', async (value) => {
        const res = await post({ ...body(), startEmpty: value });
        expect(res.status).toBe(400);
        expect(db.select().from(users).all()).toHaveLength(0);
    });
});
