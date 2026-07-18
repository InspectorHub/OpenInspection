/**
 * Task 9c (people-role-profiles) — GET /api/metrics topAgents aggregate must
 * resolve buyer-agent attribution via inspection_people (role buyer_agent),
 * not the legacy inspections.referredByAgentId column. Seeds the inspection
 * with the LEGACY column NULL and only inspection_people populated, so it
 * fails against the pre-rewrite implementation (agent excluded — the old
 * "is not null" filter on the legacy column drops it).
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
import metricsRoutes from '../../../server/api/metrics';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const AGENT_CONTACT = 'contact-agent-1';
const INSP_1 = 'insp-1';
const INSP_2 = 'insp-2';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/metrics', metricsRoutes);
    return app;
}

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

describe('GET /api/metrics — topAgents via inspection_people (Task 9c)', () => {
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
        await db.insert(schema.contacts).values({
            id: AGENT_CONTACT, tenantId: TENANT, type: 'agent', name: 'Jane', agency: 'Realty Co', email: 'jane@realty.com', createdAt: new Date(),
        });
    });

    it('legacy referredByAgentId NULL, buyer_agent inspection_people rows present — counts + names the agent', async () => {
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(schema.inspections).values([
            { id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: today, status: 'confirmed', paymentStatus: 'paid', price: 10000, referredByAgentId: null, inspectorId: null, createdAt: new Date() },
            { id: INSP_2, tenantId: TENANT, propertyAddress: '2 Oak', date: today, status: 'confirmed', paymentStatus: 'paid', price: 20000, referredByAgentId: null, inspectorId: null, createdAt: new Date() },
        ]);
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_1, AGENT_CONTACT, roleProfileId('buyer_agent'));
        await people.addPerson(TENANT, INSP_2, AGENT_CONTACT, roleProfileId('buyer_agent'));

        const res = await buildApp().request('/api/metrics?period=12m', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { topAgents: { agentId: string | null; agentName: string; count: number; revenue: number }[] } };
        expect(body.data.topAgents).toHaveLength(1);
        expect(body.data.topAgents[0].agentId).toBe(AGENT_CONTACT);
        expect(body.data.topAgents[0].agentName).toBe('Jane');
        expect(body.data.topAgents[0].count).toBe(2);
        expect(body.data.topAgents[0].revenue).toBe(30000);
    });

    it('inspection with no buyer_agent inspection_people row is excluded from topAgents', async () => {
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(schema.inspections).values({
            id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: today, status: 'confirmed', paymentStatus: 'paid', price: 10000, referredByAgentId: null, inspectorId: null, createdAt: new Date(),
        });
        const res = await buildApp().request('/api/metrics?period=12m', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { topAgents: unknown[] } };
        expect(body.data.topAgents).toEqual([]);
    });
});
