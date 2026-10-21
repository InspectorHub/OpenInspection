/**
 * GET /api/public/verify-by-token/{token} resolves the verification token printed on a signed agreement to its
 * envelope id. It is an OpenAPI route of the public verify router: public (no session needed), a token that matches
 * nothing is a 404 with the plain error body, and the route is listed in the document but never offered as an MCP tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import publicVerifyRoutes from '../../../server/api/public/verify';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const ENV_ID = '00000000-0000-0000-0000-0000000000c2';
const TOKEN = 'verification-token-abcdef0123456789';

describe('GET /api/public/verify-by-token/{token}', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    // No session variables are set anywhere: the route has to answer without one.
    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.route('/api/public', publicVerifyRoutes);
        return app;
    }
    const env = { DB: {} } as HonoConfig['Bindings'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as never);
        await db.insert(schema.inspections).values({
            id: 'insp-vt', tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01', status: 'confirmed',
            paymentStatus: 'unpaid', price: 0, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        } as never);
        await db.insert(schema.agreements).values({
            id: 'agr-vt', tenantId: TENANT, name: 'Standard Agreement', content: 'text', version: 1, createdAt: new Date(),
        } as never);
        await db.insert(schema.agreementRequests).values({
            id: ENV_ID, tenantId: TENANT, inspectionId: 'insp-vt', agreementId: 'agr-vt', clientEmail: 'jane@test.com',
            clientName: 'Jane', token: 'plain-env-token', status: 'signed', completionPolicy: 'all',
            verificationToken: TOKEN, createdAt: new Date(),
        } as never);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('resolves a known token to its envelope id without any session', async () => {
        const res = await buildApp().request(`/api/public/verify-by-token/${TOKEN}`, {}, env);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { envelopeId: ENV_ID } });
    });

    it('answers 404 with the plain error body for a token that matches nothing', async () => {
        const res = await buildApp().request('/api/public/verify-by-token/not-a-real-token', {}, env);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: { message: 'Not found', code: 'NOT_FOUND' } });
    });

    it('does not match a token by prefix', async () => {
        const res = await buildApp().request(`/api/public/verify-by-token/${TOKEN.slice(0, 10)}`, {}, env);
        expect(res.status).toBe(404);
    });

    it('is documented as a public operation that MCP never offers', () => {
        const doc = buildOpenApiDocument(buildApp(), { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const op = doc.paths?.['/api/public/verify-by-token/{token}']?.get as Record<string, unknown> | undefined;
        expect(op?.operationId).toBe('getPublicVerifyByToken');
        expect(op?.['x-scopes']).toEqual([]);
        expect(op?.['x-tier']).toBe('excluded');
    });
});
