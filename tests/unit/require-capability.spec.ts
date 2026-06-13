import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requireCapability, type OverrideResolver } from '../../server/lib/middleware/require-capability';
import { coerceOverrides, getCapabilities, type PermissionOverrides } from '../../server/lib/auth/capabilities';
import { AppError } from '../../server/lib/errors';
import type { Role } from '../../server/lib/auth/roles';

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
    const app = new Hono();
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

async function call(app: Hono) {
    const res = await app.request('/gated');
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('requireCapability middleware', () => {
    it('inspector + no overrides → publish allowed, financial denied', async () => {
        const pub = await call(buildApp('publish', { role: 'inspector', overrides: null }).app);
        expect(pub.status).toBe(200);
        expect(pub.body).toEqual({ ok: true });

        const fin = await call(buildApp('financial', { role: 'inspector', overrides: null }).app);
        expect(fin.status).toBe(403);
        expect(fin.body.error).toContain('financial');
    });

    it('inspector + {financial:true} → financial allowed', async () => {
        const fin = await call(buildApp('financial', { role: 'inspector', overrides: { financial: true } }).app);
        expect(fin.status).toBe(200);
        expect(fin.body).toEqual({ ok: true });
    });

    it('inspector + {publish:false} → publish denied (requires review)', async () => {
        const pub = await call(buildApp('publish', { role: 'inspector', overrides: { publish: false } }).app);
        expect(pub.status).toBe(403);
        expect(pub.body.error).toContain('publish');
    });

    it('owner → financial allowed even with {financial:false} override (pinned)', async () => {
        const fin = await call(buildApp('financial', { role: 'owner', overrides: { financial: false } }).app);
        expect(fin.status).toBe(200);
        expect(fin.body).toEqual({ ok: true });
    });

    it('resolves overrides fresh on every request (resolver is invoked)', async () => {
        const { app, resolver } = buildApp('manageContacts', { role: 'inspector', overrides: { manageContacts: true } });
        await call(app);
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('401 when no role is present in context', async () => {
        const app = new Hono();
        app.onError((err, c) =>
            err instanceof AppError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500),
        );
        app.get('/gated', requireCapability('publish', async () => null), (c) => c.json({ ok: true }));
        const res = await app.request('/gated');
        expect(res.status).toBe(401);
    });
});

describe('inspector capability-resolution for role-widened endpoints', () => {
    // These endpoints (invoices list → financial; contact create/update/delete →
    // manageContacts) now admit 'inspector' through the requireRole gate so the
    // capability becomes the EFFECTIVE gate. An inspector is still default-denied;
    // only an explicit {financial:true}/{manageContacts:true} override lets them
    // through. Owner/manager default true and are unaffected.
    it('inspector financial: override true → allowed, null → denied', () => {
        expect(getCapabilities('inspector', { financial: true }).financial).toBe(true);
        expect(getCapabilities('inspector', null).financial).toBe(false);
    });
    it('inspector manageContacts: override true → allowed, null → denied', () => {
        expect(getCapabilities('inspector', { manageContacts: true }).manageContacts).toBe(true);
        expect(getCapabilities('inspector', null).manageContacts).toBe(false);
    });
    it('owner/manager financial + manageContacts default true (role gate widening is a no-op for them)', () => {
        expect(getCapabilities('owner', null).financial).toBe(true);
        expect(getCapabilities('owner', null).manageContacts).toBe(true);
        expect(getCapabilities('manager', null).financial).toBe(true);
        expect(getCapabilities('manager', null).manageContacts).toBe(true);
    });
});

describe('coerceOverrides helper', () => {
    it('parses a JSON string column value', () => {
        expect(coerceOverrides('{"financial":true}')).toEqual({ financial: true });
    });
    it('whitelists an already-parsed object (json-mode column)', () => {
        expect(coerceOverrides({ financial: true, bogus: 1, publish: false })).toEqual({ financial: true, publish: false });
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
