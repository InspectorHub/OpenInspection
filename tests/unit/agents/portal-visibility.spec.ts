/**
 * Task 9 (two-layer role model) — the three buyer_agent branches retire.
 * Two different axes were sharing one key: portal VISIBILITY becomes the
 * showsInAgentPortal capability; referral ATTRIBUTION becomes the
 * referred_by_contact_id column. And the repair list resolves to the STRICTER
 * of tenant policy and role bit — neither can widen the other.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { listReferrals } from '../../../server/services/agent/referral';
import { effectiveRepairAccess } from '../../../server/lib/people/agent-repair-access';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../../server/api/agent';
import type { HonoConfig } from '../../../server/types/hono';
import { asD1Db } from '../helpers/test-db';
import { makeExecutionContext } from '../helpers/exec-ctx';

const T = '00000000-0000-0000-0000-0000000000c1';
const AGENT_USER = '00000000-0000-4000-8000-0000000000d1';
const AGENT_CONTACT = 'ct-lister';
const INSP = 'i-vis-1';

const roleProfileId = (key: string) => `crp_${T}_${key}`;

let db: BetterSQLite3Database<typeof schema>;

async function seedBase() {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: T, slug: 'acme-vis', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), T, new Date(1));
    await db.insert(schema.users).values({
        id: AGENT_USER, tenantId: null, email: 'lister@realty.com', role: 'agent', name: 'Lister', createdAt: new Date(), passwordHash: 'h',
    } as never);
    await db.insert(schema.contacts).values({
        id: AGENT_CONTACT, tenantId: T, type: 'agent', name: 'Lister', email: 'lister@realty.com', createdAt: new Date(),
    });
    await db.update(schema.contacts)
        .set({ agentUserId: AGENT_USER, agentLinkedAt: new Date() })
        .where(eq(schema.contacts.id, AGENT_CONTACT));
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '9 Elm', date: '2026-07-01', createdAt: new Date(), price: 0,
    });
}

async function seatAs(key: string) {
    await db.insert(schema.inspectionPeople).values({
        id: `ip-${key}`, tenantId: T, inspectionId: INSP, contactId: AGENT_CONTACT,
        roleProfileId: roleProfileId(key), createdAt: new Date(),
    });
}

/** Module scope, not inline at the call: the helper registers the teardown
 *  that settles background work, and that must happen during collection. */
const EXEC_CTX = makeExecutionContext().ctx;

describe('agent portal visibility', () => {
    beforeEach(seedBase);

    it('shows the inspection to a LISTING agent — visibility is the capability, not the buyer_agent key', async () => {
        await seatAs('listing_agent');
        const rows = await listReferrals({} as D1Database, AGENT_USER, { limit: 10 });
        expect(rows.map(r => r.id)).toContain(INSP);
    });

    it('hides it from a seat whose showsInAgentPortal was withdrawn by override', async () => {
        // A buyer_agent whose override withdraws portal visibility: the key
        // matches, the capability does not — the OLD code showed this row.
        await db.update(schema.contactRoleProfiles)
            .set({ capabilityOverrides: { receivesReport: true, selfRetrieveReport: true, canHaveAccount: true, showsInAgentPortal: false, canAccessRepairList: 'readwrite' } })
            .where(eq(schema.contactRoleProfiles.id, roleProfileId('buyer_agent')));
        await seatAs('buyer_agent');
        const rows = await listReferrals({} as D1Database, AGENT_USER, { limit: 10 });
        expect(rows.map(r => r.id)).not.toContain(INSP);
    });

    it('does NOT give the listing agent the repair list, even when the tenant policy is readwrite', async () => {
        await seatAs('listing_agent');
        // No tenant_configs row → tenant policy defaults to 'readwrite'; the
        // listing_agent role bit is 'off' and the stricter of the two wins.
        const rows = await listReferrals({} as D1Database, AGENT_USER, { limit: 10 });
        expect(rows[0]?.repairAccess).toBe('off');
    });
});

describe('effectiveRepairAccess', () => {
    it('takes the stricter of tenant policy and role bit, in both directions', () => {
        expect(effectiveRepairAccess('read', 'readwrite')).toBe('read');
        expect(effectiveRepairAccess('readwrite', 'read')).toBe('read');
        expect(effectiveRepairAccess('off', 'readwrite')).toBe('off');
        expect(effectiveRepairAccess('readwrite', 'off')).toBe('off');
        expect(effectiveRepairAccess('readwrite', 'readwrite')).toBe('readwrite');
    });
});

describe('referral attribution', () => {
    beforeEach(seedBase);

    it('credits the contact named in referred_by_contact_id, not the buyer agent', async () => {
        // The referrer is a PAST CLIENT; a different contact holds buyer_agent.
        await db.insert(schema.contacts).values({
            id: 'ct-pastclient', tenantId: T, type: 'client', name: 'Pat PastClient', email: 'pat@x.com', createdAt: new Date(),
        });
        await seatAs('buyer_agent');
        await db.update(schema.inspections)
            .set({ referredByContactId: 'ct-pastclient' })
            .where(eq(schema.inspections.id, INSP));

        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner' as never);
            c.set('tenantId', T);
            c.set('user', { sub: 'u-owner' } as never);
            await next();
        });
        app.route('/api/agent', agentRoutes);
        const res = await app.request('/api/agent/leaderboard', {}, { DB: {} } as never, EXEC_CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { leaderboard: Array<{ agentId: string; name: string | null; total: number }> } };
        expect(body.data.leaderboard).toHaveLength(1);
        expect(body.data.leaderboard[0].agentId).toBe('ct-pastclient');
        expect(body.data.leaderboard[0].name).toBe('Pat PastClient');
    });
});
