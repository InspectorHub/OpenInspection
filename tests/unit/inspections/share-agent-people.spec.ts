/**
 * Task 9c (people-role-profiles) — POST /api/inspections/:id/share-agent
 * must resolve the linked buyer's-agent via inspection_people (role
 * buyer_agent), not the legacy inspections.referredByAgentId column. This
 * spec seeds an inspection with the LEGACY column NULL and only
 * inspection_people populated, so it fails against the old implementation
 * (400 "No agent linked to this inspection").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { PeopleService } from '../../../server/services/people.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const AGENT_CONTACT = 'contact-agent-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const SLUG = 'acme';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let sendAgentShareLink: ReturnType<typeof vi.fn>;
let generateAgentViewToken: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    sendAgentShareLink = vi.fn().mockResolvedValue(undefined);
    generateAgentViewToken = vi.fn().mockResolvedValue('token-abc');

    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            inspection: { generateAgentViewToken },
            people: new PeopleService({ DB: {} as D1Database }),
            email: { sendAgentShareLink },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com', JWT_SECRET: 'test-secret' } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function post() {
    return new Request(`https://acme.example.com/api/inspections/${INSP_ID}/share-agent`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
}

describe('POST /api/inspections/:id/share-agent — buyer_agent via inspection_people (Task 9c)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: AGENT_CONTACT, tenantId: TENANT, type: 'agent', name: 'Jane Agent',
            email: 'jane@realty.com', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid',
            price: 0, inspectorId: null, referredByAgentId: null, createdAt: new Date(),
        });
    });

    it('legacy referredByAgentId NULL, buyer_agent inspection_people row present — resolves and emails the agent', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, AGENT_CONTACT, roleProfileId('buyer_agent'));

        const app = buildApp();
        const res = await app.fetch(post(), ENV, CTX);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { sentTo: string } };
        expect(body.data.sentTo).toBe('jane@realty.com');
        expect(sendAgentShareLink.mock.calls[0][0]).toBe('jane@realty.com');
        expect(generateAgentViewToken).toHaveBeenCalledWith(TENANT, INSP_ID);
    });

    it('no buyer_agent inspection_people row at all — 400 "No agent linked to this inspection"', async () => {
        const app = buildApp();
        const res = await app.fetch(post(), ENV, CTX);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { message: string } };
        expect(body.error.message).toBe('No agent linked to this inspection');
        expect(sendAgentShareLink).not.toHaveBeenCalled();
    });
});
