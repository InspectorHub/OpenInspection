/**
 * GET /api/inspections/schedule-conflicts — another inspector's schedule needs
 * `scheduleOthers`.
 *
 * The response carries the colliding inspections' addresses and dates for the
 * inspector named in `?inspectorId=`. Checking yourself is what the wizard does
 * and stays open to every inspector; naming someone else is the same verb the
 * assignee picker and bulk reassign already gate on `scheduleOthers`.
 *
 * GET /api/inspections/counts — deliberately NOT gated: the inspection list,
 * its stats and the dashboard are company-wide for every staff role, so the
 * counts disclose nothing the list does not. The control below pins that, so a
 * future per-inspector list scope has to revisit this route in the same change.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

const findScheduleConflicts = vi.fn();
vi.mock('../../../server/lib/schedule-conflicts', () => ({
    findScheduleConflicts: (...args: unknown[]) => findScheduleConflicts(...args),
}));

const { default: bulkRoutes } = await import('../../../server/api/inspections/bulk');

const TENANT = '00000000-0000-0000-0000-000000000001';
const SELF = 'u-self';
const OTHER = 'u-other';
const FAKE_ENV = { DB: {} } as unknown as HonoConfig['Bindings'];
const COLLISION = [{ inspectionId: 'i-1', propertyAddress: '12 Elm St', date: '2026-10-20T09:00:00Z' }];
const COUNTS = { all: 7, today: 1, upcoming: 2, past: 4, needsConfirmation: 1, awaitingReport: 0 };

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: SELF, role, tenantId: TENANT });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: { getCounts: async () => COUNTS },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', bulkRoutes);
    return app;
}

const conflicts = (app: OpenAPIHono<HonoConfig>, inspectorId?: string) =>
    app.request(`/api/inspections/schedule-conflicts?date=2026-10-20${inspectorId ? `&inspectorId=${inspectorId}` : ''}`, {}, FAKE_ENV);

describe('GET /api/inspections/schedule-conflicts — scheduleOthers for other inspectors', () => {
    it('owner may check another inspector (positive control)', async () => {
        findScheduleConflicts.mockResolvedValue(COLLISION);
        const res = await conflicts(buildApp('owner'), OTHER);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('12 Elm St');
    });

    it('manager may check another inspector (positive control)', async () => {
        findScheduleConflicts.mockResolvedValue(COLLISION);
        expect((await conflicts(buildApp('manager'), OTHER)).status).toBe(200);
    });

    it('an inspector granted scheduleOthers may check another inspector (positive control)', async () => {
        findScheduleConflicts.mockResolvedValue(COLLISION);
        expect((await conflicts(buildApp('inspector', { scheduleOthers: true }), OTHER)).status).toBe(200);
    });

    it('a default inspector checking themselves by id is admitted (positive control)', async () => {
        findScheduleConflicts.mockClear();
        findScheduleConflicts.mockResolvedValue(COLLISION);
        const res = await conflicts(buildApp('inspector'), SELF);
        expect(res.status).toBe(200);
        expect(findScheduleConflicts.mock.calls[0]?.[2]).toBe(SELF);
    });

    it('a default inspector omitting inspectorId is checked against themselves (positive control)', async () => {
        findScheduleConflicts.mockClear();
        findScheduleConflicts.mockResolvedValue(COLLISION);
        expect((await conflicts(buildApp('inspector'))).status).toBe(200);
        expect(findScheduleConflicts.mock.calls[0]?.[2]).toBe(SELF);
    });

    it('a default inspector naming another inspector is refused and nothing is looked up', async () => {
        findScheduleConflicts.mockClear();
        findScheduleConflicts.mockResolvedValue(COLLISION);
        const res = await conflicts(buildApp('inspector'), OTHER);
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain('12 Elm St');
        expect(findScheduleConflicts).not.toHaveBeenCalled();
    });

    it('an inspector whose scheduleOthers is explicitly off is refused', async () => {
        findScheduleConflicts.mockClear();
        expect((await conflicts(buildApp('inspector', { scheduleOthers: false }), OTHER)).status).toBe(403);
    });
});

describe('GET /api/inspections/counts — same company-wide scope as the list', () => {
    it.each(['owner', 'manager', 'inspector'] as const)('%s receives the company counts', async (role) => {
        const res = await buildApp(role).request('/api/inspections/counts', {}, FAKE_ENV);
        expect(res.status).toBe(200);
        expect((await res.json() as { data: typeof COUNTS }).data.all).toBe(7);
    });
});
