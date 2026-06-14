import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../server/api/admin';
import type { HonoConfig } from '../../server/types/hono';

// C-15: resendConfigured now reads the CANONICAL encrypted_secrets store via
// the single envelope-aware entry point lib/secrets-cache#loadTenantSecrets
// (returns DECRYPTED records). Stub it; per-test overrides below.
vi.mock('../../server/lib/secrets-cache', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadTenantSecrets: vi.fn(async () => null),
}));
import { loadTenantSecrets } from '../../server/lib/secrets-cache';

/**
 * C-10 ③-D (B-4 / A-7) — GET+PATCH /api/admin/communication.
 * Tenant transactional-email identity (senderEmail / replyTo) + display flags.
 * The real bug was "Reply-To unsaveable" — there was no endpoint at all.
 */
describe('admin communication config — ③-D (B-4)', () => {
    function buildApp(branding: Record<string, unknown>, env: Record<string, unknown> = { JWT_SECRET: 'x' }) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', 't1');
            c.set('services', { branding } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        return { app, env };
    }

    beforeEach(() => {
        vi.mocked(loadTenantSecrets).mockReset().mockResolvedValue(null);
    });

    it('GET returns senderEmail/replyTo + flags from branding config (tenant Resend key in the canonical store)', async () => {
        const getBranding = vi.fn().mockResolvedValue({
            senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', icsToken: 'icstok', googleRefreshToken: 'g',
            emailMode: 'own', senderDisplayName: 'Acme Inspections', siteName: 'Acme Home Inspections', pointOfContact: 'inspector',
        });
        // C-15: configured via the canonical encrypted_secrets store.
        vi.mocked(loadTenantSecrets).mockResolvedValue({ RESEND_API_KEY: 're_123' });
        const { app, env } = buildApp({ getBranding });
        const res = await app.request('/api/admin/communication', {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { senderEmail: string; replyTo: string; resendConfigured: boolean; googleCalendarConnected: boolean; icsUrl: string | null; templates: unknown[]; emailMode: string; senderDisplayName: string; siteName: string | null; pointOfContact: string } };
        expect(body.data.senderEmail).toBe('noreply@acme.com');
        expect(body.data.replyTo).toBe('office@acme.com');
        expect(body.data.resendConfigured).toBe(true);
        expect(body.data.googleCalendarConnected).toBe(true);
        expect(body.data.icsUrl).toContain('icstok');
        expect(Array.isArray(body.data.templates)).toBe(true);
        expect(body.data.emailMode).toBe('own');
        expect(body.data.senderDisplayName).toBe('Acme Inspections');
        expect(body.data.siteName).toBe('Acme Home Inspections');
        expect(body.data.pointOfContact).toBe('inspector');
        expect(getBranding).toHaveBeenCalledWith('t1', expect.anything());
    });

    it('GET reports resendConfigured=false when neither env nor tenant secret has a Resend key', async () => {
        const getBranding = vi.fn().mockResolvedValue({ senderEmail: null, replyTo: null });
        const { app, env } = buildApp({ getBranding });
        const res = await app.request('/api/admin/communication', {}, env);
        const body = await res.json() as { data: { resendConfigured: boolean; senderEmail: string | null; googleCalendarConnected: boolean } };
        expect(body.data.resendConfigured).toBe(false);
        expect(body.data.senderEmail).toBeNull();
        expect(body.data.googleCalendarConnected).toBe(false);
    });

    it('PATCH persists senderEmail/replyTo + identity fields via branding.updateBranding', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ updateBranding });
        const res = await app.request('/api/admin/communication', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', emailMode: 'platform', senderDisplayName: 'Acme', pointOfContact: 'company' }),
        }, env);
        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith('t1', { senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', emailMode: 'platform', senderDisplayName: 'Acme', pointOfContact: 'company' });
    });

    it('PATCH accepts nulls (clearing the addresses)', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ updateBranding });
        const res = await app.request('/api/admin/communication', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ senderEmail: null, replyTo: null, emailMode: 'platform', senderDisplayName: null, pointOfContact: 'inspector' }),
        }, env);
        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith('t1', { senderEmail: null, replyTo: null, emailMode: 'platform', senderDisplayName: null, pointOfContact: 'inspector' });
    });
});
