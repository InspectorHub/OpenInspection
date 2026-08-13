/**
 * Task 8 (two-layer role model) — `referred_by_contact_id` names WHO sent us
 * the job, separately from `referral_source`, which names the CHANNEL.
 * Attribution used to be inferred from whoever held buyer_agent, which credits
 * a stranger when a past client refers the job.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import coreRoutes from '../../../server/api/inspections/core';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import type { HonoConfig } from '../../../server/types/hono';

const T = 't-refby-1';
const OTHER = 't-refby-2';
const INSP = 'i-refby-1';

let db: BetterSQLite3Database<typeof schema>;

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', T);
        c.set('user', { sub: 'u-1', role: 'owner', tenantId: T } as never);
        c.set('services', { inspection: new InspectionService({} as never, undefined, new ScopedDB(db as never, T)) } as never);
        await next();
    });
    app.route('/api/inspections', coreRoutes);
    return app;
}

async function patchInspection(body: Record<string, unknown>) {
    return buildApp().request(`/api/inspections/${INSP}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }, ENV, CTX);
}

describe('referred_by_contact_id', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values([
            { id: T, slug: 't-refby-a', createdAt: new Date() },
            { id: OTHER, slug: 't-refby-b', createdAt: new Date() },
        ]);
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: T, propertyAddress: '1 Main', date: '2026-07-01', createdAt: new Date(), price: 0,
        });
        await db.insert(schema.contacts).values([
            // A CLIENT-type contact — a past client really does refer jobs.
            { id: 'ct-pastclient', tenantId: T, type: 'client', name: 'Past Client', email: 'pc@x.com', phone: null, createdAt: new Date() },
            { id: 'ct-foreign', tenantId: OTHER, type: 'agent', name: 'Foreign', email: 'f@x.com', phone: null, createdAt: new Date() },
        ]);
    });

    it('persists a non-agent contact as the referrer', async () => {
        const res = await patchInspection({ referredByContactId: 'ct-pastclient' });
        expect(res.status).toBe(200);
        const row = await db.select({ r: schema.inspections.referredByContactId })
            .from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        expect(row?.r).toBe('ct-pastclient');
    });

    it('accepts null (no referrer) independently of referral_source', async () => {
        const res = await patchInspection({ referralSource: 'Google Search', referredByContactId: null });
        expect(res.status).toBe(200);
        const row = await db.select({ r: schema.inspections.referredByContactId, s: schema.inspections.referralSource })
            .from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        expect(row?.r).toBeNull();
        expect(row?.s).toBe('Google Search');
    });

    it("rejects another tenant's contact, never a silent write", async () => {
        const res = await patchInspection({ referredByContactId: 'ct-foreign' });
        expect(res.status).toBe(400);
        const row = await db.select({ r: schema.inspections.referredByContactId })
            .from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        expect(row?.r).toBeNull();
    });
});
