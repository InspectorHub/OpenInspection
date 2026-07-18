/**
 * Task 9c (people-role-profiles) — the public token-based ICS subscription
 * feed (GET /api/ics/:token, server/api/ics.ts) embeds the client name in
 * each VEVENT's DESCRIPTION via `r.clientName`, read straight off the
 * inspections row. Convert to source the primary client's name from the
 * inspection_people join (avoiding N+1 across the feed's up-to-90-day
 * window) instead of the legacy inspections.client_name column (frozen
 * cache, dropped Task 13).
 *
 * Seeds an inspection with the LEGACY clientName column NULL and only
 * inspection_people populated, so this fails against the old implementation
 * (which reads only inspections.client_name and would render "Client: ").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppEnv } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import icsRoutes from '../../../server/api/ics';

const TENANT = '00000000-0000-0000-0000-000000000d1';
const CLIENT = 'contact-client-ics';
const INSP = 'insp-ics-token-1';
const TOKEN = 'ics-token-1234567890abcdef';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

function tomorrowStr(): string {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function makeExecCtx() {
    return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

describe('GET /api/ics/:token — primary-client sourcing (Task 9c)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let app: Hono<{ Bindings: AppEnv }>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-ics', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, icsToken: TOKEN, updatedAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', createdAt: new Date(),
        });
        // Legacy clientName column intentionally NULL — only inspection_people
        // carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St',
            clientName: null, clientEmail: null, price: 25000,
            date: tomorrowStr(), status: 'confirmed', paymentStatus: 'unpaid',
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP, CLIENT, roleProfileId('client'));

        app = new Hono<{ Bindings: AppEnv }>();
        app.route('/api/ics', icsRoutes);
    });

    it('embeds the primary client\'s name in the VEVENT DESCRIPTION', async () => {
        const res = await app.request(`/api/ics/${TOKEN}`, {}, { DB: {} } as unknown as AppEnv, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('BEGIN:VEVENT');
        expect(body).toContain('DESCRIPTION:Client: Jane Client | Fee: $25000');
    });

    it('no primary client at all — DESCRIPTION renders an empty client name (no legacy-column fallback)', async () => {
        const { eq } = await import('drizzle-orm');
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP));

        const res = await app.request(`/api/ics/${TOKEN}`, {}, { DB: {} } as unknown as AppEnv, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('DESCRIPTION:Client:  | Fee: $25000');
    });
});
