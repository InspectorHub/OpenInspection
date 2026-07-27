/**
 * IA-36 — report-access lifecycle cascades:
 *   - removing a person from an inspection revokes their report-access token
 *     (revokeForRecipient), so a removed recipient's link stops working;
 *   - unpublishing a report expires every token for the inspection
 *     (setExpiryForInspection), so no live link points at a withdrawn report.
 *
 * Both are wired at the route layer (the services stay decoupled), so these
 * spy on the portal-access calls made by the DELETE-person and unpublish
 * handlers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '550e8400-e29b-41d4-a716-446655440000';
const PERSON = 'ip-1';

let revokeForRecipient: ReturnType<typeof vi.fn>;
let setExpiryForInspection: ReturnType<typeof vi.fn>;
let removePerson: ReturnType<typeof vi.fn>;
let listPeople: ReturnType<typeof vi.fn>;
let unpublishReport: ReturnType<typeof vi.fn>;

function buildApp() {
    revokeForRecipient = vi.fn().mockResolvedValue({ previousTokenHash: null });
    setExpiryForInspection = vi.fn().mockResolvedValue(undefined);
    removePerson = vi.fn().mockResolvedValue({ email: 'buyer@example.com' });
    unpublishReport = vi.fn().mockResolvedValue(undefined);
    // IA-36 ⑬ — DELETE now reads the roster first to refuse removing the last
    // client-side person. Two client rows here, so removal is allowed.
    listPeople = vi.fn().mockResolvedValue([
        { id: PERSON, contactId: 'c1', roleProfileId: 'rp1', roleKey: 'client', roleLabel: 'Client', kind: 'client', name: 'Buyer', email: 'buyer@example.com', phone: null, agency: null },
        { id: 'ip-2', contactId: 'c2', roleProfileId: 'rp2', roleKey: 'co_client', roleLabel: 'Co-Client', kind: 'client', name: 'Co', email: 'co@example.com', phone: null, agency: null },
    ]);

    // assertInspectionOwned selects the inspection row — return one so the
    // route treats it as owned by this tenant.
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: () => ({ from: () => ({ where: () => ({ get: async () => ({ id: INSP }) }) }) }),
    });

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('services', {
            people: { removePerson, listPeople },
            portalAccess: { revokeForRecipient, setExpiryForInspection },
            inspection: { unpublishReport },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        throw err;
    });
    return app;
}

const ENV = { DB: {} } as never;

describe('IA-36 report-access cascades', () => {
    beforeEach(() => buildApp());

    it('removing a person revokes their report-access token', async () => {
        const app = buildApp();
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/people/${PERSON}`, { method: 'DELETE' }), ENV);
        expect(res.status).toBe(200);
        expect(removePerson).toHaveBeenCalledWith(TENANT, INSP, PERSON);
        expect(revokeForRecipient).toHaveBeenCalledWith(TENANT, INSP, 'buyer@example.com');
    });

    it('does not revoke when the removed row had no email (already-gone / no contact)', async () => {
        const app = buildApp();
        removePerson.mockResolvedValueOnce({ email: null });
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/people/${PERSON}`, { method: 'DELETE' }), ENV);
        expect(res.status).toBe(200);
        expect(revokeForRecipient).not.toHaveBeenCalled();
    });

    it('unpublishing expires every access token for the inspection', async () => {
        const app = buildApp();
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/unpublish`, { method: 'POST' }), ENV);
        expect(res.status).toBe(200);
        expect(unpublishReport).toHaveBeenCalledWith(INSP, TENANT);
        expect(setExpiryForInspection).toHaveBeenCalledTimes(1);
        const [t, i, expiry] = setExpiryForInspection.mock.calls[0];
        expect(t).toBe(TENANT);
        expect(i).toBe(INSP);
        expect(typeof expiry).toBe('number'); // immediate expiry timestamp
    });
});
