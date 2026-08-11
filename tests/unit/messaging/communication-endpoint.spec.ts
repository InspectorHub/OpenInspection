/**
 * GET /api/inspections/:id/communication (Communication plan A1.1/A1.2).
 *
 * The payload is TWO arrays — person-written messages and platform deliveries —
 * never one merged list: the UI never interleaves them (design §2), and a
 * server-side merge only to split again client-side is how the merged
 * rendering comes back.
 *
 * This endpoint replaced `GET /api/automations/logs/{inspectionId}`, a fully
 * defined route with no caller; the last spec here pins that the old route is
 * actually gone rather than quietly coexisting.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import communicationRoutes from '../../../server/api/inspections/communication';
import automationRoutes from '../../../server/api/automations';
import { MessageService } from '../../../server/services/message.service';
import { AutomationService } from '../../../server/services/automation.service';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = 't-comm-1';
const OTHER_TENANT = 't-comm-2';
const INSP = 'i-comm-1';

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        // The route reads two services; hand it real instances over the mocked
        // drizzle handle so queries hit the same in-memory DB the fixtures do.
        c.set('services', {
            message: new MessageService({} as never),
            automation: new AutomationService({} as never),
        } as never);
        await next();
    });
    app.route('/api/inspections', communicationRoutes);
    app.route('/api/automations', automationRoutes);
    return app;
}

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'a-comm', createdAt: new Date() },
        { id: OTHER_TENANT, slug: 'b-comm', createdAt: new Date() },
    ]);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-07-01',
        createdAt: new Date(), price: 0,
    });
});

describe('GET /api/inspections/:id/communication', () => {
    it('returns messages and deliveries as two arrays, never one merged list', async () => {
        await db.insert(schema.inspectionMessages).values({
            id: 'm1', tenantId: TENANT, inspectionId: INSP, contactId: 'c1',
            fromRole: 'client', fromName: 'Dana', body: 'Is the roof bad?',
            attachments: [], readAt: null, createdAt: new Date('2026-07-02T10:00:00Z'),
        });
        await db.insert(schema.automationLogs).values({
            id: 'l1', tenantId: TENANT, automationId: 'a1', inspectionId: INSP,
            recipient: 'dana@example.com', recipientRoleKey: 'client', channel: 'email',
            sendAt: new Date('2026-07-02T11:00:00Z'), status: 'sent',
        } as never);

        const res = await buildApp().request(`/api/inspections/${INSP}/communication`, {}, ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { messages: unknown[]; deliveries: unknown[] } };
        expect(Array.isArray(body.data.messages)).toBe(true);
        expect(Array.isArray(body.data.deliveries)).toBe(true);
        expect(body.data.messages).toHaveLength(1);
        expect(body.data.deliveries).toHaveLength(1);

        const msg = body.data.messages[0] as { direction: string; contactId: string; body: string };
        expect(msg.direction).toBe('in');
        expect(msg.contactId).toBe('c1');

        const del = body.data.deliveries[0] as { direction: string; channel: string; status: string; source: string };
        expect(del.direction).toBe('out');
        expect(del.channel).toBe('email');
        expect(del.status).toBe('sent');
        expect(del.source).toBe('automation');
    });

    it('resolves the role label, and falls back to the raw key for a deleted role', async () => {
        await db.insert(schema.contactRoleProfiles).values([
            { id: 'crp-live', tenantId: TENANT, key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', active: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 'crp-dead', tenantId: TENANT, key: 'retired_role', label: 'Retired Label', kind: 'other', active: false, createdAt: new Date(), updatedAt: new Date() },
        ] as never);
        await db.insert(schema.automationLogs).values([
            { id: 'l-live', tenantId: TENANT, automationId: 'a1', inspectionId: INSP, recipient: 'a@x.com', recipientRoleKey: 'buyer_agent', channel: 'email', sendAt: new Date('2026-07-02T10:00:00Z'), status: 'sent' },
            { id: 'l-dead', tenantId: TENANT, automationId: 'a1', inspectionId: INSP, recipient: 'b@x.com', recipientRoleKey: 'retired_role', channel: 'email', sendAt: new Date('2026-07-02T10:00:00Z'), status: 'sent' },
        ] as never);

        const res = await buildApp().request(`/api/inspections/${INSP}/communication`, {}, ENV, CTX);
        const body = await res.json() as { data: { deliveries: Array<{ recipient: string; roleKey: string | null; roleLabel: string | null }> } };
        const live = body.data.deliveries.find(d => d.recipient === 'a@x.com')!;
        const dead = body.data.deliveries.find(d => d.recipient === 'b@x.com')!;
        expect(live.roleLabel).toBe("Buyer's Agent");
        // A deactivated role must NOT resurrect its label; the raw key is the
        // honest answer, and a missing row would be worse than an ugly one.
        expect(dead.roleLabel).toBeNull();
        expect(dead.roleKey).toBe('retired_role');
    });

    it('passes the raw skip reason through untouched — the English mapping is UI-side', async () => {
        await db.insert(schema.automationLogs).values({
            id: 'l-skip', tenantId: TENANT, automationId: 'a1', inspectionId: INSP,
            recipient: '+15550001111', recipientRoleKey: 'client', channel: 'sms',
            sendAt: new Date('2026-07-02T10:00:00Z'), status: 'skipped', error: 'no sms consent',
        } as never);
        const res = await buildApp().request(`/api/inspections/${INSP}/communication`, {}, ENV, CTX);
        const body = await res.json() as { data: { deliveries: Array<{ reasonCode: string | null }> } };
        expect(body.data.deliveries[0].reasonCode).toBe('no sms consent');
    });

    it('hides rows whose send_at is still in the future', async () => {
        await db.insert(schema.automationLogs).values({
            id: 'l-future', tenantId: TENANT, automationId: 'a1', inspectionId: INSP,
            recipient: 'x@x.com', recipientRoleKey: 'client', channel: 'email',
            sendAt: new Date(Date.now() + 86_400_000), status: 'pending',
        } as never);
        const res = await buildApp().request(`/api/inspections/${INSP}/communication`, {}, ENV, CTX);
        const body = await res.json() as { data: { deliveries: unknown[] } };
        // A delayed automation's rows are a plan, not a state — surfacing a
        // "pending" row dated tomorrow reads as a failure.
        expect(body.data.deliveries).toHaveLength(0);
    });

    it("404s for another tenant's inspection without leaking either array", async () => {
        await db.insert(schema.inspections).values({
            id: 'i-foreign', tenantId: OTHER_TENANT, propertyAddress: '9 Elm', date: '2026-07-01',
            createdAt: new Date(), price: 0,
        });
        const res = await buildApp().request('/api/inspections/i-foreign/communication', {}, ENV, CTX);
        expect(res.status).toBe(404);
    });

    it('the retired per-inspection automations logs route is gone', async () => {
        // Two endpoints over one query is how they drift; the old one must 404,
        // not silently keep serving the narrower payload.
        const res = await buildApp().request(`/api/automations/logs/${INSP}`, {}, ENV, CTX);
        expect(res.status).toBe(404);
    });
});
