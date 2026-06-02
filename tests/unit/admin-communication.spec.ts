import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../server/api/admin';
import type { HonoConfig } from '../../server/types/hono';

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

    it('GET returns senderEmail/replyTo + flags from branding config', async () => {
        const getBranding = vi.fn().mockResolvedValue({
            senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com', icsToken: 'icstok', googleRefreshToken: 'g',
        });
        const getDecryptedSecrets = vi.fn().mockResolvedValue({ resendApiKey: 're_123' });
        const { app, env } = buildApp({ getBranding, getDecryptedSecrets });
        const res = await app.request('/api/admin/communication', {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { senderEmail: string; replyTo: string; resendConfigured: boolean; googleCalendarConnected: boolean; icsUrl: string | null; templates: unknown[] } };
        expect(body.data.senderEmail).toBe('noreply@acme.com');
        expect(body.data.replyTo).toBe('office@acme.com');
        expect(body.data.resendConfigured).toBe(true);
        expect(body.data.googleCalendarConnected).toBe(true);
        expect(body.data.icsUrl).toContain('icstok');
        expect(Array.isArray(body.data.templates)).toBe(true);
        expect(getBranding).toHaveBeenCalledWith('t1', expect.anything());
    });

    it('GET reports resendConfigured=false when neither env nor tenant secret has a Resend key', async () => {
        const getBranding = vi.fn().mockResolvedValue({ senderEmail: null, replyTo: null });
        const getDecryptedSecrets = vi.fn().mockResolvedValue({});
        const { app, env } = buildApp({ getBranding, getDecryptedSecrets });
        const res = await app.request('/api/admin/communication', {}, env);
        const body = await res.json() as { data: { resendConfigured: boolean; senderEmail: string | null; googleCalendarConnected: boolean } };
        expect(body.data.resendConfigured).toBe(false);
        expect(body.data.senderEmail).toBeNull();
        expect(body.data.googleCalendarConnected).toBe(false);
    });

    it('PATCH persists senderEmail/replyTo via branding.updateBranding', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ updateBranding });
        const res = await app.request('/api/admin/communication', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com' }),
        }, env);
        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith('t1', { senderEmail: 'noreply@acme.com', replyTo: 'office@acme.com' });
    });

    it('PATCH accepts nulls (clearing the addresses)', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ updateBranding });
        const res = await app.request('/api/admin/communication', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ senderEmail: null, replyTo: null }),
        }, env);
        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith('t1', { senderEmail: null, replyTo: null });
    });
});
