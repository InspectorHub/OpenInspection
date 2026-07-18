/**
 * Task 9c (people-role-profiles) — GET /api/agent/my-reports and
 * GET /api/agent/leaderboard must resolve buyer-agent attribution via
 * inspection_people (role buyer_agent), not the legacy
 * inspections.referredByAgentId column. Each spec seeds the inspection with
 * the LEGACY column NULL and only inspection_people populated, so it fails
 * against the pre-rewrite implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { PeopleService } from '../../../server/services/people.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../../server/api/agent';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const AGENT_CONTACT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_CONTACT = '00000000-0000-4000-8000-0000000000a2';
const INSP_1 = '00000000-0000-4000-8000-0000000000b1';
const INSP_2 = '00000000-0000-4000-8000-0000000000b2';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;

function buildApp(userRole: string) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', userRole as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: AGENT_CONTACT } as never);
        await next();
    });
    app.route('/api/agent', agentRoutes);
    return app;
}

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

describe('GET /api/agent/my-reports — buyer_agent via inspection_people (Task 9c)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: AGENT_CONTACT, tenantId: TENANT, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: OTHER_CONTACT, tenantId: TENANT, type: 'agent', name: 'Other', email: 'other@realty.com', createdAt: new Date() },
        ]);
        await db.insert(schema.inspections).values([
            { id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid', price: 0, referredByAgentId: null, inspectorId: null, createdAt: new Date() },
            { id: INSP_2, tenantId: TENANT, propertyAddress: '2 Oak', date: '2026-06-02', status: 'confirmed', paymentStatus: 'paid', price: 0, referredByAgentId: null, inspectorId: null, createdAt: new Date() },
        ]);
    });

    it('legacy referredByAgentId NULL, buyer_agent inspection_people row present — my-reports resolves it (own agentId)', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_1, AGENT_CONTACT, roleProfileId('buyer_agent'));

        const res = await buildApp('manager').request('/api/agent/my-reports', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { reports: { id: string }[] } };
        expect(body.data.reports.map(r => r.id)).toEqual([INSP_1]);
    });

    it('excludes an inspection whose buyer_agent is a different contact', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_2, OTHER_CONTACT, roleProfileId('buyer_agent'));

        const res = await buildApp('manager').request('/api/agent/my-reports', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { reports: { id: string }[] } };
        expect(body.data.reports.map(r => r.id)).toEqual([]);
    });

    it('?agentId= override resolves that agent\'s inspection via inspection_people', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_2, OTHER_CONTACT, roleProfileId('buyer_agent'));

        const res = await buildApp('manager').request(`/api/agent/my-reports?agentId=${OTHER_CONTACT}`, {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { reports: { id: string }[] } };
        expect(body.data.reports.map(r => r.id)).toEqual([INSP_2]);
    });
});

describe('GET /api/agent/leaderboard — buyer_agent via inspection_people (Task 9c)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: AGENT_CONTACT, tenantId: TENANT, type: 'agent', name: 'Jane', agency: 'Realty Co', email: 'jane@realty.com', createdAt: new Date() },
        ]);
    });

    it('legacy referredByAgentId NULL, buyer_agent inspection_people rows present — counts + names the agent', async () => {
        await db.insert(schema.inspections).values([
            { id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid', price: 0, referredByAgentId: null, inspectorId: null, createdAt: new Date() },
            { id: INSP_2, tenantId: TENANT, propertyAddress: '2 Oak', date: '2026-06-02', status: 'confirmed', paymentStatus: 'paid', price: 0, referredByAgentId: null, inspectorId: null, createdAt: new Date() },
        ]);
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_1, AGENT_CONTACT, roleProfileId('buyer_agent'));
        await people.addPerson(TENANT, INSP_2, AGENT_CONTACT, roleProfileId('buyer_agent'));

        const res = await buildApp('manager').request('/api/agent/leaderboard', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { leaderboard: { agentId: string; name: string; total: number }[] } };
        expect(body.data.leaderboard).toHaveLength(1);
        expect(body.data.leaderboard[0].agentId).toBe(AGENT_CONTACT);
        expect(body.data.leaderboard[0].name).toBe('Jane');
        expect(body.data.leaderboard[0].total).toBe(2);
    });

    it('inspection with no buyer_agent inspection_people row is excluded from the leaderboard', async () => {
        await db.insert(schema.inspections).values({
            id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid', price: 0, referredByAgentId: null, inspectorId: null, createdAt: new Date(),
        });
        const res = await buildApp('manager').request('/api/agent/leaderboard', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { leaderboard: unknown[] } };
        expect(body.data.leaderboard).toEqual([]);
    });
});
