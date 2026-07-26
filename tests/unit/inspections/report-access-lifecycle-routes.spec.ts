/**
 * IA-36 ②④⑦⑫⑬ — the People-card verbs, at the route layer.
 *
 * There are three verbs on a person, not five (2026-07-23 decision):
 *   Resend         — unchanged link, handled by the existing send-report flow
 *   Reset          — rotate this recipient's link in place
 *   Remove         — they left the inspection; their link dies with them
 * plus the seat move (Make primary) that ⑫⑬ made possible.
 *
 * Both destructive verbs write an audit event: rotation destroys the old
 * secret (the unique index leaves no dead row to inspect afterwards), so the
 * only durable record that "the link the customer is holding was replaced at
 * 14:02 by Dana" is the audit row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const auditFromContext = vi.fn();
vi.mock('../../../server/lib/audit', () => ({
    auditFromContext: (...args: unknown[]) => auditFromContext(...args),
    writeAuditLogWithSlug: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '550e8400-e29b-41d4-a716-446655440000';
const PERSON = 'ip-1';

const CLIENT = { id: PERSON, contactId: 'c1', roleProfileId: 'rp1', roleKey: 'client', roleLabel: 'Client', kind: 'client', name: 'Buyer', email: 'buyer@example.com', phone: null, agency: null };
const CO_CLIENT = { ...CLIENT, id: 'ip-2', contactId: 'c2', roleKey: 'co_client', roleLabel: 'Co-Client', name: 'Co Buyer', email: 'co@example.com' };

let rotateForRecipient: ReturnType<typeof vi.fn>;
let revokeForRecipient: ReturnType<typeof vi.fn>;
let setExpiryForInspection: ReturnType<typeof vi.fn>;
let listAccessForInspection: ReturnType<typeof vi.fn>;
let listPeople: ReturnType<typeof vi.fn>;
let removePerson: ReturnType<typeof vi.fn>;
let makePrimary: ReturnType<typeof vi.fn>;

function buildApp(people = [CLIENT, CO_CLIENT]) {
    rotateForRecipient = vi.fn().mockResolvedValue({ token: 'brand-new-secret', previousTokenHash: 'hash-of-old' });
    revokeForRecipient = vi.fn().mockResolvedValue({ previousTokenHash: 'hash-of-old' });
    setExpiryForInspection = vi.fn().mockResolvedValue(undefined);
    listAccessForInspection = vi.fn().mockResolvedValue([]);
    listPeople = vi.fn().mockResolvedValue(people);
    removePerson = vi.fn().mockResolvedValue({ email: 'buyer@example.com' });
    makePrimary = vi.fn().mockResolvedValue(undefined);
    auditFromContext.mockClear();

    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: () => ({ from: () => ({ where: () => ({ get: async () => ({ id: INSP }) }) }) }),
    });

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('services', {
            people: { listPeople, removePerson, makePrimary },
            portalAccess: { rotateForRecipient, revokeForRecipient, setExpiryForInspection, listAccessForInspection },
            inspection: { unpublishReport: vi.fn() },
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
const post = (app: ReturnType<typeof buildApp>, path: string, body?: unknown) =>
    app.fetch(new Request(`https://x/api/inspections${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), ENV);

beforeEach(() => { buildApp(); });

describe('② POST /:id/people/:personId/reset-access', () => {
    it('rotates THIS recipient in place', async () => {
        const app = buildApp();
        const res = await post(app, `/${INSP}/people/${PERSON}/reset-access`);
        expect(res.status).toBe(200);
        expect(rotateForRecipient).toHaveBeenCalledWith(TENANT, INSP, 'buyer@example.com');
    });

    it('never returns the new secret in the response body — the link travels by email, not by screen', async () => {
        const app = buildApp();
        const res = await post(app, `/${INSP}/people/${PERSON}/reset-access`);
        expect(await res.text()).not.toContain('brand-new-secret');
    });

    it('404s when that person is not on the inspection', async () => {
        const app = buildApp([CO_CLIENT]);
        expect((await post(app, `/${INSP}/people/${PERSON}/reset-access`)).status).toBe(404);
        expect(rotateForRecipient).not.toHaveBeenCalled();
    });

    it('400s when the person has no email — there is no link to reset', async () => {
        const app = buildApp([{ ...CLIENT, email: null }]);
        expect((await post(app, `/${INSP}/people/${PERSON}/reset-access`)).status).toBe(400);
        expect(rotateForRecipient).not.toHaveBeenCalled();
    });

    it('404s when the recipient never had a link (nothing rotated)', async () => {
        const app = buildApp();
        rotateForRecipient.mockResolvedValueOnce(null);
        expect((await post(app, `/${INSP}/people/${PERSON}/reset-access`)).status).toBe(404);
    });
});

describe('④ rotation and revocation are auditable', () => {
    it('reset writes portal_access.rotated carrying the OLD token HASH, never a plaintext token', async () => {
        const app = buildApp();
        await post(app, `/${INSP}/people/${PERSON}/reset-access`);
        expect(auditFromContext).toHaveBeenCalled();
        const [, action, entityType, options] = auditFromContext.mock.calls[0];
        expect(action).toBe('portal_access.rotated');
        expect(entityType).toBe('inspection');
        expect(options.metadata.previousTokenHash).toBe('hash-of-old');
        expect(options.metadata.recipientEmail).toBe('buyer@example.com');
        expect(JSON.stringify(options.metadata)).not.toContain('brand-new-secret');
    });

    it('remove writes portal_access.revoked', async () => {
        const app = buildApp();
        await app.fetch(new Request(`https://x/api/inspections/${INSP}/people/${CO_CLIENT.id}`, { method: 'DELETE' }), ENV);
        const call = auditFromContext.mock.calls.find((c) => c[1] === 'portal_access.revoked');
        expect(call).toBeDefined();
        expect(call![3].metadata.previousTokenHash).toBe('hash-of-old');
    });

    it('remove of someone who never had a link writes no access audit', async () => {
        const app = buildApp();
        removePerson.mockResolvedValueOnce({ email: null });
        await app.fetch(new Request(`https://x/api/inspections/${INSP}/people/${CO_CLIENT.id}`, { method: 'DELETE' }), ENV);
        expect(auditFromContext.mock.calls.find((c) => c[1] === 'portal_access.revoked')).toBeUndefined();
    });
});

describe('⑫⑬ the primary-client seat moves', () => {
    it('POST make-primary swaps the seat', async () => {
        const app = buildApp();
        const res = await post(app, `/${INSP}/people/${CO_CLIENT.id}/make-primary`);
        expect(res.status).toBe(200);
        expect(makePrimary).toHaveBeenCalledWith(TENANT, INSP, CO_CLIENT.id);
    });

    it('the primary client CAN be removed once someone else is on the client side', async () => {
        const app = buildApp([CLIENT, CO_CLIENT]);
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/people/${PERSON}`, { method: 'DELETE' }), ENV);
        expect(res.status).toBe(200);
        expect(removePerson).toHaveBeenCalled();
    });

    it('the SOLE client cannot be removed — refused with a reason, not silently ignored', async () => {
        const app = buildApp([CLIENT]);
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/people/${PERSON}`, { method: 'DELETE' }), ENV);
        expect(res.status).toBe(409);
        expect(removePerson).not.toHaveBeenCalled();
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toMatch(/make someone else primary/i);
    });
});

describe('⑦ PUT /:id/report-link-expiry — a duration, applied deliberately', () => {
    it('a 90-day duration becomes an absolute expiry ~90 days out', async () => {
        const app = buildApp();
        const before = Date.now();
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/report-link-expiry`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ttl: { count: 90, unit: 'days' } }),
        }), ENV);
        expect(res.status).toBe(200);
        const [, , at] = setExpiryForInspection.mock.calls[0];
        expect(at).toBeGreaterThanOrEqual(before + 90 * 86_400_000);
    });

    it('"never" lifts the expiry (null), it does not push it far into the future', async () => {
        const app = buildApp();
        await app.fetch(new Request(`https://x/api/inspections/${INSP}/report-link-expiry`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ttl: 'never' }),
        }), ENV);
        expect(setExpiryForInspection).toHaveBeenCalledWith(TENANT, INSP, null);
    });

    it('rejects a bogus unit rather than guessing', async () => {
        const app = buildApp();
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/report-link-expiry`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ttl: { count: 3, unit: 'fortnights' } }),
        }), ENV);
        expect(res.status).toBe(400);
        expect(setExpiryForInspection).not.toHaveBeenCalled();
    });
});

describe('⑪ GET /:id/people carries each recipient state', () => {
    it('merges link state onto the person rows by email', async () => {
        const app = buildApp();
        listAccessForInspection.mockResolvedValueOnce([
            { recipientEmail: 'buyer@example.com', sentAt: 1_700_000_000_000, expiresAt: null, status: 'active' },
        ]);
        const res = await app.fetch(new Request(`https://x/api/inspections/${INSP}/people`), ENV);
        const body = await res.json() as { data: Array<{ email: string | null; access: { status: string; sentAt: number | null } }> };
        const buyer = body.data.find((p) => p.email === 'buyer@example.com')!;
        expect(buyer.access).toEqual({ status: 'active', sentAt: 1_700_000_000_000, expiresAt: null });
        // Never sent = an explicit state, not a missing field the card has to guess at.
        const co = body.data.find((p) => p.email === 'co@example.com')!;
        expect(co.access).toEqual({ status: 'not_sent', sentAt: null, expiresAt: null });
    });
});
