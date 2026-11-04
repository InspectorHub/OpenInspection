/**
 * The agent repair items state each photo key relative to the company (`inspections/<id>/...`), and the agent photo route
 * resolves that key against the company the agent is associated with. The whole body is searched raw and percent-encoded
 * for the company id, and every URL the page would build from the body is fetched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { PeopleService } from '../../../server/services/people.service';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';
import { accessToInspection, listRecommendationsForAgent, listReferrals } from '../../../server/services/agent/referral';
import agentRoutes from '../../../server/api/agent';
import { agentNoticeRoutes } from '../../../server/api/agent/notices';
import type { HonoConfig } from '../../../server/types/hono';
import { asD1Db } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';
const INSPECTOR_2 = '00000000-0000-0000-0000-00000000ab02';
const AGENT_CONTACT_2 = 'jane-c2';
const AGENT_USER = '00000000-0000-0000-0000-000000000a01';
const OTHER_AGENT = '00000000-0000-0000-0000-000000000a02';
const INSPECTOR = '00000000-0000-0000-0000-00000000ab01';
const AGENT_CONTACT = 'jane-c1';

const PHOTO_A = `${T1}/inspections/i-1/photos/a.jpg`;
const PHOTO_B = `${T1}/inspections/i-1/photos/b.jpg`;
const PHOTO_C = `${T2}/inspections/i-t2/photos/c.jpg`;
const BYTES = new Uint8Array([1, 2, 3, 4]);

let db: BetterSQLite3Database<typeof schema>;

const templateSnapshot = {
    sections: [{ id: 'sec1', title: 'Roof', items: [{ id: 'item1', label: 'Shingles', tabs: { defects: [{ id: 'd1', title: 'Missing shingles', category: 'safety', comment: 'default' }] } }] }],
};
// One photo as a plain key, one as an object, as the editor writes both shapes.
const resultsData = { '_default:sec1:item1': { tabs: { defects: [{ cannedId: 'd1', included: true, photos: [PHOTO_A, { key: PHOTO_B }] }] } } };
const resultsData2 = { '_default:sec1:item1': { tabs: { defects: [{ cannedId: 'd1', included: true, photos: [PHOTO_C] }] } } };

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({ id: T1, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await seedRoleProfiles(asD1Db(db), T1, new Date(1));
    await db.insert(schema.users).values([
        { id: AGENT_USER, tenantId: null, email: 'jane@realty.com', role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h' },
        { id: OTHER_AGENT, tenantId: null, email: 'other@realty.com', role: 'agent', name: 'Other', createdAt: new Date(), passwordHash: 'h' },
        { id: INSPECTOR, tenantId: T1, email: 'mike@acme.com', role: 'inspector', name: 'Mike', createdAt: new Date(), passwordHash: 'h' },
    ]);
    await db.insert(schema.contacts).values({ id: AGENT_CONTACT, tenantId: T1, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() });
    await db.update(schema.contacts).set({ agentUserId: AGENT_USER, agentLinkedAt: new Date() }).where(eq(schema.contacts.id, AGENT_CONTACT));
    for (const id of ['i-1', 'i-2']) {
        await db.insert(schema.inspections).values({
            id, tenantId: T1, inspectorId: INSPECTOR, propertyAddress: `${id} Main`, date: '2026-06-01', status: 'completed',
            reportStatus: REPORT_STATUS.PUBLISHED, paymentStatus: 'paid', price: 0, createdAt: new Date(), templateSnapshot,
        });
        await db.insert(schema.inspectionResults).values({ id: `res-${id}`, tenantId: T1, inspectionId: id, data: resultsData, lastSyncedAt: new Date() });
    }
    await new PeopleService({ DB: {} as D1Database }).addPerson(T1, 'i-1', AGENT_CONTACT, `crp_${T1}_buyer_agent`);
    // A second company that has the same agent account on one of its own inspections.
    await db.insert(schema.tenants).values({ id: T2, slug: 'beta', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await seedRoleProfiles(asD1Db(db), T2, new Date(1));
    await db.insert(schema.users).values({ id: INSPECTOR_2, tenantId: T2, email: 'ann@beta.com', role: 'inspector', name: 'Ann', createdAt: new Date(), passwordHash: 'h' });
    await db.insert(schema.contacts).values({ id: AGENT_CONTACT_2, tenantId: T2, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() });
    await db.update(schema.contacts).set({ agentUserId: AGENT_USER, agentLinkedAt: new Date() }).where(eq(schema.contacts.id, AGENT_CONTACT_2));
    await db.insert(schema.inspections).values({
        id: 'i-t2', tenantId: T2, inspectorId: INSPECTOR_2, propertyAddress: 'i-t2 Main', date: '2026-06-01', status: 'completed',
        reportStatus: REPORT_STATUS.PUBLISHED, paymentStatus: 'paid', price: 0, createdAt: new Date(), templateSnapshot,
    });
    await db.insert(schema.inspectionResults).values({ id: 'res-i-t2', tenantId: T2, inspectionId: 'i-t2', data: resultsData2, lastSyncedAt: new Date() });
    await new PeopleService({ DB: {} as D1Database }).addPerson(T2, 'i-t2', AGENT_CONTACT_2, `crp_${T2}_buyer_agent`);
});

function build(userId: string) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'agent');
        c.set('user', { sub: userId } as never);
        c.set('services', {
            inspection: { resolveReleaseGate: async () => null },
            agent: {
                accessToInspection: (agent: string, inspection: string) => accessToInspection({} as D1Database, agent, inspection),
                listRecommendationsForAgent: (agent: string) => listRecommendationsForAgent({} as D1Database, agent),
                listReferrals: (agent: string, opts: { limit: number }) => listReferrals({} as D1Database, agent, opts),
            },
        } as never);
        await next();
    });
    app.route('/api/agent', agentRoutes);
    app.route('/api/agent', agentNoticeRoutes);
    return app;
}

const bucket = (held: Record<string, Uint8Array>) => {
    const get = vi.fn(async (key: string) => (held[key] ? { body: new Blob([new Uint8Array(held[key]!)]).stream(), httpMetadata: { contentType: 'image/jpeg' }, httpEtag: '"e"' } : null));
    return { env: { PHOTOS: { get } } as never, get };
};
const HELD = { [PHOTO_A]: BYTES, [PHOTO_B]: BYTES, [PHOTO_C]: BYTES };
const photoUrl = (inspectionId: string, key: string) => `/api/agent/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}&w=320`;

type Body = { data: { safety: Array<{ photos: string[]; inspectionId: string }> } };

describe('the agent repair items and the agent photo route', () => {
    it('control: the stored defect photos name the company, so its absence below is the rewrite', () => {
        expect(JSON.stringify(resultsData)).toContain(T1);
    });

    it('states every photo key relative to the company: the whole body holds no company id, raw or percent-encoded', async () => {
        const res = await build(AGENT_USER).request('/api/agent/my-repair-items', {}, bucket(HELD).env);
        expect(res.status).toBe(200);
        const text = await res.text();
        const body = JSON.parse(text) as Body;
        const byInspection = new Map(body.data.safety.map((row) => [row.inspectionId, row.photos]));
        expect(byInspection.get('i-1')).toEqual(['inspections/i-1/photos/a.jpg', 'inspections/i-1/photos/b.jpg']);
        expect(byInspection.get('i-t2')).toEqual(['inspections/i-t2/photos/c.jpg']);
        expect(body.data.safety).toHaveLength(2);
        for (const company of [T1, T2]) {
            expect(text).not.toContain(company);
            expect(encodeURIComponent(text)).not.toContain(company);
        }
    });

    it('lists the referrals of every company without a company id in the body', async () => {
        const rows = await listReferrals({} as D1Database, AGENT_USER, { limit: 100 });
        // Control: the service rows do name their company, so the absence below is the route.
        expect(rows.map((r) => (r as { tenantId?: string }).tenantId).sort()).toEqual([T1, T2]);
        const res = await build(AGENT_USER).request('/api/agent/referrals', {}, bucket(HELD).env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect((JSON.parse(text) as { data: unknown[] }).data).toHaveLength(2);
        for (const company of [T1, T2]) {
            expect(text).not.toContain(company);
            expect(encodeURIComponent(text)).not.toContain(company);
        }
    });

    it('lists the notices of every company without a company id in the body', async () => {
        const now = new Date();
        for (const [tenantId, contactId] of [[T1, AGENT_CONTACT], [T2, AGENT_CONTACT_2]] as const) {
            const id = `n-${tenantId.slice(-1)}`;
            await db.insert(schema.notifications).values({
                id, tenantId, userId: null, contactId, type: 'report.published', title: 'Your report is ready', body: null, inspectionId: 'i-1',
                entityType: 'inspection', entityId: 'i-1', metadata: null, readAt: null, archivedAt: null, createdAt: now,
            });
            await db.insert(schema.automationLogs).values({
                id: `${id}-log`, tenantId, automationId: 'auto-1', inspectionId: 'i-1', recipient: 'jane@realty.com', recipientContactId: contactId,
                channel: 'email', sendAt: now, status: 'sent', error: null, noticeId: id,
            });
            // Control: the stored header names its company.
            expect((await db.select().from(schema.notifications).where(eq(schema.notifications.id, id)).get())?.tenantId).toBe(tenantId);
        }
        const res = await build(AGENT_USER).request('/api/agent/notices', {}, bucket(HELD).env);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect((JSON.parse(text) as { data: { notices: unknown[] } }).data.notices).toHaveLength(2);
        for (const company of [T1, T2]) {
            expect(text).not.toContain(company);
            expect(encodeURIComponent(text)).not.toContain(company);
        }
    });

    it('positive control: every URL the page builds from the body fetches bytes', async () => {
        const app = build(AGENT_USER);
        const { env } = bucket(HELD);
        const body = (await (await app.request('/api/agent/my-repair-items', {}, env)).json()) as Body;
        expect(body.data.safety).toHaveLength(2);
        for (const row of body.data.safety) {
            for (const key of row.photos) {
                const res = await app.request(photoUrl(row.inspectionId, key), {}, env);
                expect(res.status, `${row.inspectionId} ${key}`).toBe(200);
                expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
            }
        }
    });

    it('resolves a relative key against the company of its own inspection: a key of the other company does not open on this inspection', async () => {
        const { env, get } = bucket(HELD);
        const app = build(AGENT_USER);
        expect((await app.request(photoUrl('i-1', 'inspections/i-t2/photos/c.jpg'), {}, env)).status).toBe(404);
        expect((await app.request(photoUrl('i-1', PHOTO_C), {}, env)).status).toBe(404);
        expect((await app.request(photoUrl('i-t2', 'inspections/i-1/photos/a.jpg'), {}, env)).status).toBe(404);
        expect(get).not.toHaveBeenCalled();
        // Control: each key opens on its own inspection.
        expect((await app.request(photoUrl('i-t2', 'inspections/i-t2/photos/c.jpg'), {}, env)).status).toBe(200);
        expect(get).toHaveBeenCalledWith(PHOTO_C);
    });

    it('still accepts the full key of a link built earlier', async () => {
        const { env, get } = bucket(HELD);
        const res = await build(AGENT_USER).request(photoUrl('i-1', PHOTO_A), {}, env);
        expect(res.status).toBe(200);
        expect(get).toHaveBeenCalledWith(PHOTO_A);
    });

    it('refuses another inspection, another company, a dot segment and an empty key, and never reads the bucket', async () => {
        const { env, get } = bucket({ ...HELD, [`${T1}/inspections/i-2/photos/a.jpg`]: BYTES, [`${T2}/inspections/i-1/photos/a.jpg`]: BYTES });
        const app = build(AGENT_USER);
        const refused = [
            'inspections/i-2/photos/a.jpg',
            `${T1}/inspections/i-2/photos/a.jpg`,
            `${T2}/inspections/i-1/photos/a.jpg`,
            'inspections/i-1/../i-2/photos/a.jpg',
            `${T1}/inspections/i-1/../i-2/photos/a.jpg`,
            'inspections/i-1/',
            'credentials/logo.png',
            '',
        ];
        for (const key of refused) expect((await app.request(photoUrl('i-1', key), {}, env)).status, JSON.stringify(key)).toBe(404);
        expect(get).not.toHaveBeenCalled();
    });

    it('serves nothing to an agent with no association, relative key or not', async () => {
        const { env, get } = bucket(HELD);
        const app = build(OTHER_AGENT);
        expect((await app.request(photoUrl('i-1', 'inspections/i-1/photos/a.jpg'), {}, env)).status).toBe(404);
        expect((await app.request(photoUrl('i-1', PHOTO_A), {}, env)).status).toBe(404);
        expect(get).not.toHaveBeenCalled();
    });
});
