/**
 * IA-63 — GET /api/metrics must expose a per-inspector productivity dimension
 * (count / revenue / average turnaround) so multi-inspector companies can see
 * team output, not just workspace totals. "Who did this inspection" resolves
 * from lead_inspector_id, falling back to inspector_id. Turnaround is the days
 * from inspection date to the first report_versions publish; an inspector with
 * nothing published reports null (not 0).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import metricsRoutes from '../../../server/api/metrics';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const U1 = 'user-inspector-1';
const U2 = 'user-inspector-2';

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

type ByInspectorRow = { inspectorId: string | null; inspectorName: string; count: number; revenue: number; avgTurnaroundDays: number | null };

describe('GET /api/metrics — byInspector (IA-63)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values([
            { id: U1, tenantId: TENANT, email: 'ins1@acme.test', passwordHash: 'x', name: 'Alice Inspector', createdAt: new Date() },
            { id: U2, tenantId: TENANT, email: 'ins2@acme.test', passwordHash: 'x', name: 'Bob Inspector', createdAt: new Date() },
        ] as never);
    });

    it('groups by lead/fallback inspector with correct per-inspector count and revenue', async () => {
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(schema.inspections).values([
            // Alice — attributed via inspector_id (lead NULL ⇒ fallback).
            { id: 'i-a1', tenantId: TENANT, propertyAddress: '1 Main', date: today, status: 'completed', paymentStatus: 'paid', price: 10000, inspectorId: U1, createdAt: new Date() },
            { id: 'i-a2', tenantId: TENANT, propertyAddress: '2 Main', date: today, status: 'completed', paymentStatus: 'paid', price: 15000, inspectorId: U1, createdAt: new Date() },
            // Bob — attributed via lead_inspector_id, which must win over inspector_id.
            { id: 'i-b1', tenantId: TENANT, propertyAddress: '3 Oak', date: today, status: 'completed', paymentStatus: 'paid', price: 20000, inspectorId: U1, leadInspectorId: U2, createdAt: new Date() },
            { id: 'i-b2', tenantId: TENANT, propertyAddress: '4 Oak', date: today, status: 'completed', paymentStatus: 'paid', price: 5000, inspectorId: U1, leadInspectorId: U2, createdAt: new Date() },
        ] as never);

        const res = await buildApp().request('/api/metrics?period=12m', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const rows = ((await res.json()) as { data: { byInspector: ByInspectorRow[] } }).data.byInspector;
        expect(rows).toHaveLength(2);

        const alice = rows.find((r) => r.inspectorId === U1)!;
        const bob = rows.find((r) => r.inspectorId === U2)!;
        expect(alice.inspectorName).toBe('Alice Inspector');
        expect(alice.count).toBe(2);
        expect(alice.revenue).toBe(25000);
        // lead_inspector_id wins: both i-b* count for Bob, not Alice.
        expect(bob.inspectorName).toBe('Bob Inspector');
        expect(bob.count).toBe(2);
        expect(bob.revenue).toBe(25000);
    });

    it('reports turnaround from first publish, and null (not 0) for an inspector with nothing published', async () => {
        const date = '2026-07-01';
        await db.insert(schema.inspections).values([
            { id: 'pub', tenantId: TENANT, propertyAddress: '1 Main', date, status: 'delivered', paymentStatus: 'paid', price: 10000, inspectorId: U1, createdAt: new Date() },
            { id: 'unpub', tenantId: TENANT, propertyAddress: '2 Oak', date, status: 'completed', paymentStatus: 'unpaid', price: 10000, inspectorId: U2, createdAt: new Date() },
        ] as never);
        // Alice's inspection published 3 days after the inspection date.
        await db.insert(schema.reportVersions).values({
            id: 'rv1', tenantId: TENANT, inspectionId: 'pub', versionNumber: 1,
            snapshotJson: '{}', publishedAt: new Date('2026-07-04T00:00:00Z'), publishedBy: U1,
        } as never);

        const res = await buildApp().request('/api/metrics?period=12m', {}, ENV, CTX);
        const rows = ((await res.json()) as { data: { byInspector: ByInspectorRow[] } }).data.byInspector;

        const alice = rows.find((r) => r.inspectorId === U1)!;
        const bob = rows.find((r) => r.inspectorId === U2)!;
        expect(alice.avgTurnaroundDays).toBeCloseTo(3, 1);
        expect(bob.avgTurnaroundDays).toBeNull();
    });
});
