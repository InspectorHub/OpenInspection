import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../../server/api/admin';
import type { HonoConfig } from '../../../server/types/hono';

// C-15: resendConfigured now reads the CANONICAL secrets_enc store via
// the single envelope-aware entry point lib/secrets-cache#loadTenantSecrets
// (returns DECRYPTED records). Stub it; per-test overrides below.
vi.mock('../../../server/lib/secrets-cache', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadTenantSecrets: vi.fn(async () => null),
}));
import { loadTenantSecrets } from '../../../server/lib/secrets-cache';

vi.mock('../../../server/lib/calendar/connection', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    userHasCalendarConnection: vi.fn(async () => false),
    getCalendarConnection: vi.fn(async () => null),
}));
import { userHasCalendarConnection, getCalendarConnection } from '../../../server/lib/calendar/connection';

vi.mock('../../../server/lib/calendar/resolve-google-oauth', () => ({
    isGoogleOAuthConfigured: vi.fn(async (env: { GOOGLE_CLIENT_ID?: string }) =>
        !!(env.GOOGLE_CLIENT_ID?.trim()),
    ),
    loadGoogleOAuthMode: vi.fn(async () => 'platform'),
    resolveGoogleOAuthCredentials: vi.fn(),
}));

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
            c.set('user', { sub: 'admin-1' } as HonoConfig['Variables']['user']);
            c.set('services', { branding } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        return { app, env };
    }

    beforeEach(() => {
        vi.mocked(loadTenantSecrets).mockReset().mockResolvedValue(null);
        vi.mocked(userHasCalendarConnection).mockReset().mockResolvedValue(false);
        vi.mocked(getCalendarConnection).mockReset().mockResolvedValue(null);
    });

    it('GET returns senderEmail/replyTo + flags from branding config (tenant Resend key in the canonical store)', async () => {
        const getBranding = vi.fn().mockResolvedValue({
            senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', icsToken: 'icstok',
            emailMode: 'own', senderDisplayName: 'Acme Inspections', companyName: 'Acme Home Inspections', pointOfContact: 'inspector',
        });
        const getIntegrationConfig = vi.fn().mockResolvedValue({ googleOAuthMode: 'platform' });
        vi.mocked(userHasCalendarConnection).mockResolvedValue(true);
        vi.mocked(getCalendarConnection).mockResolvedValue({
            capabilities: 'events_read_write',
        } as never);
        // C-15: configured via the canonical secrets_enc store.
        vi.mocked(loadTenantSecrets).mockResolvedValue({ RESEND_API_KEY: 're_123' });
        const { app, env } = buildApp({ getBranding, getIntegrationConfig }, { JWT_SECRET: 'x', GOOGLE_CLIENT_ID: 'g-client', GOOGLE_CLIENT_SECRET: 'g-secret' });
        const res = await app.request('/api/admin/communication', {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { senderEmail: string; replyTo: string; resendConfigured: boolean; googleCalendarConnected: boolean; googleOAuthConfigured: boolean; googleOAuthMode: string; icsUrl: string | null; templates: unknown[]; emailMode: string; senderDisplayName: string; companyName: string | null; pointOfContact: string } };
        expect(body.data.senderEmail).toBe('noreply@acme.com');
        expect(body.data.replyTo).toBe('office@acme.com');
        expect(body.data.resendConfigured).toBe(true);
        expect(body.data.googleCalendarConnected).toBe(true);
        expect(body.data.googleOAuthConfigured).toBe(true);
        expect(body.data.googleOAuthMode).toBe('platform');
        expect(body.data.icsUrl).toContain('icstok');
        expect(Array.isArray(body.data.templates)).toBe(true);
        expect(body.data.emailMode).toBe('own');
        expect(body.data.senderDisplayName).toBe('Acme Inspections');
        expect(body.data.companyName).toBe('Acme Home Inspections');
        expect(body.data.pointOfContact).toBe('inspector');
        expect(getBranding).toHaveBeenCalledWith('t1', expect.anything());
    });

    it('GET reports resendConfigured=false when neither env nor tenant secret has a Resend key', async () => {
        const getBranding = vi.fn().mockResolvedValue({ senderEmail: null, replyTo: null });
        const getIntegrationConfig = vi.fn().mockResolvedValue({});
        const { app, env } = buildApp({ getBranding, getIntegrationConfig });
        const res = await app.request('/api/admin/communication', {}, env);
        const body = await res.json() as { data: { resendConfigured: boolean; senderEmail: string | null; googleCalendarConnected: boolean } };
        expect(body.data.resendConfigured).toBe(false);
        expect(body.data.senderEmail).toBeNull();
        expect(body.data.googleCalendarConnected).toBe(false);
    });

    it('PATCH persists senderEmail/replyTo + identity fields via branding.updateBranding', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const updateIntegrationConfig = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ updateBranding, updateIntegrationConfig });
        const res = await app.request('/api/admin/communication', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', emailMode: 'platform', senderDisplayName: 'Acme', pointOfContact: 'company' }),
        }, env);
        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith('t1', { senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', emailMode: 'platform', senderDisplayName: 'Acme', pointOfContact: 'company' });
    });

    it('PATCH persists googleOAuthMode via updateIntegrationConfig', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const updateIntegrationConfig = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ updateBranding, updateIntegrationConfig });
        const res = await app.request('/api/admin/communication', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                senderEmail: null, replyTo: 'office@acme.com', emailMode: 'platform',
                senderDisplayName: null, pointOfContact: 'company', googleOAuthMode: 'own',
            }),
        }, env);
        expect(res.status).toBe(200);
        expect(updateIntegrationConfig).toHaveBeenCalledWith('t1', { googleOAuthMode: 'own' });
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
