import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requireCapability, type OverrideResolver } from '../../../server/lib/middleware/require-capability';
import { coerceOverrides, type PermissionOverrides } from '../../../server/lib/auth/capabilities';
import { AppError } from '../../../server/lib/errors';
import type { Role } from '../../../server/lib/auth/roles';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * Task 10 — requireCapability middleware.
 *
 * The middleware reads permission_overrides FRESH from the DB on every request
 * (overrides change without re-login; the JWT never carries them). We inject a
 * deterministic OverrideResolver instead of hitting D1, then assert the
 * getCapabilities() decision surfaces as allow (next runs) or 403.
 */

function buildApp(
    cap: Parameters<typeof requireCapability>[0],
    { role, overrides }: { role: Role; overrides: PermissionOverrides | null },
) {
    const resolver: OverrideResolver = vi.fn(async () => overrides);
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ error: err.message }, err.status);
        return c.json({ error: String(err) }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('userRole', role);
        c.set('user', { sub: 'user-1', role, tenantId: 't1' });
        await next();
    });
    app.get('/gated', requireCapability(cap, resolver), (c) => c.json({ ok: true }));
    return { app, resolver };
}

async function call(app: Hono<HonoConfig>) {
    const res = await app.request('/gated');
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('requireCapability middleware', () => {
    it('inspector + no overrides → publish allowed, companyFinance denied', async () => {
        const pub = await call(buildApp('publish', { role: 'inspector', overrides: null }).app);
        expect(pub.status).toBe(200);
        expect(pub.body).toEqual({ ok: true });

        const fin = await call(buildApp('companyFinance', { role: 'inspector', overrides: null }).app);
        expect(fin.status).toBe(403);
        expect(fin.body.error).toContain('companyFinance');
    });

    it('inspector + no overrides → inspectionFees allowed (the default that lets them price their own inspections)', async () => {
        const fees = await call(buildApp('inspectionFees', { role: 'inspector', overrides: null }).app);
        expect(fees.status).toBe(200);
        expect(fees.body).toEqual({ ok: true });
    });

    it('inspector + {companyFinance:true} → companyFinance allowed', async () => {
        const fin = await call(buildApp('companyFinance', { role: 'inspector', overrides: { companyFinance: true } }).app);
        expect(fin.status).toBe(200);
        expect(fin.body).toEqual({ ok: true });
    });

    it('inspectionFees does not open companyFinance, and the other way round', async () => {
        const feesOnly = { inspectionFees: true, companyFinance: false };
        const financeOnly = { inspectionFees: false, companyFinance: true };
        expect((await call(buildApp('companyFinance', { role: 'manager', overrides: feesOnly }).app)).status).toBe(403);
        expect((await call(buildApp('inspectionFees', { role: 'manager', overrides: financeOnly }).app)).status).toBe(403);
    });

    it('inspector + {publish:false} → publish denied (requires review)', async () => {
        const pub = await call(buildApp('publish', { role: 'inspector', overrides: { publish: false } }).app);
        expect(pub.status).toBe(403);
        expect(pub.body.error).toContain('publish');
    });

    it('owner → both money capabilities allowed even with both overridden off (pinned)', async () => {
        const off = { inspectionFees: false, companyFinance: false };
        for (const cap of ['inspectionFees', 'companyFinance'] as const) {
            const res = await call(buildApp(cap, { role: 'owner', overrides: off }).app);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true });
        }
    });

    it('resolves overrides fresh on every request (resolver is invoked)', async () => {
        const { app, resolver } = buildApp('manageContacts', { role: 'inspector', overrides: { manageContacts: true } });
        await call(app);
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('401 when no role is present in context', async () => {
        const app = new Hono<HonoConfig>();
        app.onError((err, c) =>
            err instanceof AppError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500),
        );
        app.get('/gated', requireCapability('publish', async () => null), (c) => c.json({ ok: true }));
        const res = await app.request('/gated');
        expect(res.status).toBe(401);
    });
});

describe('coerceOverrides helper', () => {
    it('parses a JSON string column value', () => {
        expect(coerceOverrides('{"companyFinance":true}')).toEqual({ companyFinance: true });
    });
    it('whitelists an already-parsed object (json-mode column)', () => {
        expect(coerceOverrides({ companyFinance: true, bogus: 1, publish: false })).toEqual({ companyFinance: true, publish: false });
    });
    it('returns null for null / empty / non-object / malformed', () => {
        expect(coerceOverrides(null)).toBeNull();
        expect(coerceOverrides(undefined)).toBeNull();
        expect(coerceOverrides('{}')).toBeNull();
        expect(coerceOverrides('not json')).toBeNull();
        expect(coerceOverrides(42)).toBeNull();
        expect(coerceOverrides({ onlyJunk: 'x' })).toBeNull();
    });
});
