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
import { asD1Db } from '../helpers/test-db';
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
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: AGENT_CONTACT, tenantId: TENANT, type: 'agent', name: 'Jane', agency: 'Realty Co', email: 'jane@realty.com', createdAt: new Date(),
        });
    });

    it('counts + names the referrer from referred_by_contact_id (Task 9: attribution reads the column)', async () => {
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(schema.inspections).values([
            { id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: today, status: 'confirmed', paymentStatus: 'paid', price: 10000, referredByContactId: AGENT_CONTACT, inspectorId: null, createdAt: new Date() },
            { id: INSP_2, tenantId: TENANT, propertyAddress: '2 Oak', date: today, status: 'confirmed', paymentStatus: 'paid', price: 20000, referredByContactId: AGENT_CONTACT, inspectorId: null, createdAt: new Date() },
        ]);
        const res = await buildApp().request('/api/metrics?from=2024-01-01&to=2028-12-31', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { topAgents: { agentId: string | null; agentName: string; count: number; revenue: number }[] } };
        expect(body.data.topAgents).toHaveLength(1);
        expect(body.data.topAgents[0].agentId).toBe(AGENT_CONTACT);
        expect(body.data.topAgents[0].agentName).toBe('Jane');
        expect(body.data.topAgents[0].count).toBe(2);
        expect(body.data.topAgents[0].revenue).toBe(30000);
    });

    it('buckets referral_source rows the contact-keyed query drops (#278)', async () => {
        // The contact-keyed query filters `referred_by_contact_id is not null`,
        // so a job whose only attribution is free text ("Google") was dropped
        // ENTIRELY — and for a one-person firm those are usually the only rows
        // there are. The two are different KINDS of answer and stay in separate
        // rows keyed by `kind`, never merged into one column.
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(schema.inspections).values([
            { id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: today, status: 'confirmed', paymentStatus: 'paid', price: 10000, referredByContactId: AGENT_CONTACT, inspectorId: null, createdAt: new Date() },
            { id: INSP_2, tenantId: TENANT, propertyAddress: '2 Oak', date: today, status: 'confirmed', paymentStatus: 'paid', price: 20000, referredByContactId: null, referralSource: 'Google', inspectorId: null, createdAt: new Date() },
            { id: 'insp-3', tenantId: TENANT, propertyAddress: '3 Elm', date: today, status: 'confirmed', paymentStatus: 'paid', price: 5000, referredByContactId: null, referralSource: '   ', inspectorId: null, createdAt: new Date() },
        ] as never);

        const res = await buildApp().request('/api/metrics?from=2024-01-01&to=2028-12-31', {}, ENV, CTX);
        const body = await res.json() as { data: { topAgents: { agentId: string | null; agentName: string; kind: string; count: number; revenue: number }[] } };

        // Contact-keyed first, then the coarse bucket.
        expect(body.data.topAgents.map(r => [r.kind, r.agentName])).toEqual([
            ['contact', 'Jane'],
            ['source', 'Google'],
        ]);
        const source = body.data.topAgents[1];
        expect(source.agentId).toBeNull();
        expect(source.count).toBe(1);
        expect(source.revenue).toBe(20000);
        // A whitespace-only source is not an answer and gets no row.
    });

    it('inspection with no referrer is excluded from topAgents', async () => {
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(schema.inspections).values({
            id: INSP_1, tenantId: TENANT, propertyAddress: '1 Main', date: today, status: 'confirmed', paymentStatus: 'paid', price: 10000, inspectorId: null, createdAt: new Date(),
        });
        const res = await buildApp().request('/api/metrics?from=2024-01-01&to=2028-12-31', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { topAgents: unknown[] } };
        expect(body.data.topAgents).toEqual([]);
    });
});
