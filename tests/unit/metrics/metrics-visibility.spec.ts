/**
 * `companyFinance` decides whether a caller may see money; the visibility scope decides whether
 * they may see other people's work. A restricted inspector who also holds `companyFinance` gets the
 * same own-row view as an inspector without it, never the company figures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn } from '../helpers/test-db';
import metricsRoutes from '../../../server/api/metrics';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { seedVisibilityFixture, TENANT, USERS, VISIBLE_TO_A, ALL_OF_TENANT } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

interface Payload {
    scope: 'all' | 'self';
    totalRevenue: number | null;
    totalInspections: number;
    monthly: unknown[];
    topAgents: unknown[];
    paymentSummary: unknown;
    byInspector: Array<{ inspectorId: string; ledCount: number; assistedCount: number; attributedRevenueCents: number | null }>;
}

const CTX = makeExecutionContext().ctx;

describe('GET /api/metrics honours the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
    });

    async function metrics(role: UserRole, actor: string, overrides: Record<string, boolean> | null): Promise<Payload> {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('tenantId', TENANT);
            c.set('user', { sub: actor, role, tenantId: TENANT });
            c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
            await next();
        });
        app.route('/api/metrics', metricsRoutes);
        const res = await app.request('/api/metrics', {}, { DB: {} } as never, CTX);
        expect(res.status).toBe(200);
        return ((await res.json()) as { data: Payload }).data;
    }

    it('a restricted inspector holding companyFinance still gets only their own row, null company figures and a scoped count', async () => {
        const m = await metrics('inspector', USERS.inspA, { viewAllInspections: false, companyFinance: true });
        expect(m.scope).toBe('self');
        expect(m.totalRevenue).toBeNull();
        expect(m.paymentSummary).toBeNull();
        expect(m.monthly).toEqual([]);
        expect(m.topAgents).toEqual([]);
        expect(m.totalInspections).toBe(VISIBLE_TO_A.length);
        expect(m.byInspector.map(r => r.inspectorId)).toEqual([USERS.inspA]);
    });
    it('control: the same grant on an unrestricted inspector gets the company view', async () => {
        const m = await metrics('inspector', USERS.inspAll, { companyFinance: true });
        expect(m.scope).toBe('all');
        expect(m.totalRevenue).not.toBeNull();
        expect(m.totalInspections).toBe(ALL_OF_TENANT.length);
        expect(m.byInspector.map(r => r.inspectorId)).toEqual(expect.arrayContaining([USERS.inspA, USERS.inspB]));
    });
    it('control: a manager and an owner are never narrowed', async () => {
        for (const [role, id] of [['manager', USERS.manager], ['owner', USERS.owner]] as const) {
            const m = await metrics(role, id, null);
            expect(m.scope).toBe('all');
            expect(m.totalInspections).toBe(ALL_OF_TENANT.length);
        }
    });
    it('a restricted inspector without companyFinance sees only the scoped count (the older own-row view, now scoped)', async () => {
        const m = await metrics('inspector', USERS.inspA, { viewAllInspections: false });
        expect(m.scope).toBe('self');
        expect(m.totalInspections).toBe(VISIBLE_TO_A.length);
    });
});
