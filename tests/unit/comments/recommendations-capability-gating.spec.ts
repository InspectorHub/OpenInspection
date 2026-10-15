import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

/**
 * The comment (recommendations) library shares its authoring rules with
 * templates: creating needs `templateCreate`, editing needs `templateEdit`,
 * deleting needs `templateDelete`. Before this spec the library was gated by
 * role alone, so an owner who switched a capability off for an inspector had
 * closed the template routes and left the same content editable one path over.
 *
 * Asserted at the HTTP boundary on the REAL router: a unit call to the
 * middleware would not prove it is mounted, and the authorization-surface spec
 * only checks that declaration and enforcement agree, not that a route
 * declares anything.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/audit', () => ({ auditFromContext: vi.fn() }));

// eslint-disable-next-line import/order
import recommendationsRoutes from '../../../server/api/recommendations';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REC = { id: 'r1', tenantId: TENANT_ID, name: 'Seal the gap', severity: 'minor', defaultRepairSummary: 'Seal it', category: null, recommendedContractorTypeId: null, createdByUserId: 'u1', createdAt: 1 };

const recommendation = {
    listByTenant: vi.fn(async () => [REC]),
    getById: vi.fn(async () => REC),
    create: vi.fn(async () => REC),
    update: vi.fn(async () => REC),
    delete: vi.fn(async () => {}),
};

type Overrides = Partial<Record<'templateCreate' | 'templateEdit' | 'templateDelete', boolean>> | null;

function buildApp(role: UserRole, overrides: Overrides = null) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('userRole', role);
        c.set('user', { sub: 'u1' } as never);
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as never);
        c.set('services', { recommendation } as never);
        return next();
    });
    app.route('/api/recommendations', recommendationsRoutes);
    return app;
}

const BODY = JSON.stringify({ name: 'Seal the gap', severity: 'minor', defaultRepairSummary: 'Seal it' });
const JSON_HEADERS = { 'content-type': 'application/json' };

const post = (a: Hono<HonoConfig>) => a.request('/api/recommendations', { method: 'POST', headers: JSON_HEADERS, body: BODY });
const put = (a: Hono<HonoConfig>) => a.request('/api/recommendations/r1', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ name: 'Renamed' }) });
const del = (a: Hono<HonoConfig>) => a.request('/api/recommendations/r1', { method: 'DELETE' });
const list = (a: Hono<HonoConfig>) => a.request('/api/recommendations');

describe('recommendations library capability gating', () => {
    beforeEach(() => Object.values(recommendation).forEach(fn => fn.mockClear()));

    it('refuses create without templateCreate, before the service runs', async () => {
        expect((await post(buildApp('inspector', { templateCreate: false }))).status).toBe(403);
        expect(recommendation.create).not.toHaveBeenCalled();
    });

    it('refuses edit without templateEdit, before the service runs', async () => {
        expect((await put(buildApp('inspector', { templateEdit: false }))).status).toBe(403);
        expect(recommendation.update).not.toHaveBeenCalled();
    });

    it('refuses delete for an out-of-the-box inspector (templateDelete defaults off)', async () => {
        expect((await del(buildApp('inspector'))).status).toBe(403);
        expect(recommendation.delete).not.toHaveBeenCalled();
    });

    it('admits the same writes when the capability is on (controls)', async () => {
        expect((await post(buildApp('inspector'))).status).toBe(200);
        expect((await put(buildApp('inspector'))).status).toBe(200);
        expect((await del(buildApp('inspector', { templateDelete: true }))).status).toBe(200);
        expect(recommendation.create).toHaveBeenCalledTimes(1);
        expect(recommendation.update).toHaveBeenCalledTimes(1);
        expect(recommendation.delete).toHaveBeenCalledTimes(1);
    });

    it('keeps owner and manager unaffected', async () => {
        for (const role of ['owner', 'manager'] as const) {
            expect((await post(buildApp(role))).status).toBe(200);
            expect((await put(buildApp(role))).status).toBe(200);
            expect((await del(buildApp(role))).status).toBe(200);
        }
    });

    it('keeps reads open to an inspector whose write capabilities are all off', async () => {
        const app = buildApp('inspector', { templateCreate: false, templateEdit: false, templateDelete: false });
        expect((await list(app)).status).toBe(200);
        expect((await app.request('/api/recommendations/r1')).status).toBe(200);
    });
});
