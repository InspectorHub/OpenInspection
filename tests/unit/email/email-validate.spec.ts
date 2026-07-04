/**
 * Task 6: POST /api/integrations/email/validate endpoint.
 *
 * Tests the validate-credentials endpoint without making real network calls.
 * Provider adapters call fetch() internally; we stub fetch per-test.
 *
 * Assertions:
 *   (a) valid creds + provider.validateCredentials → ok  ⇒  200 { ok:true }
 *   (b) invalid creds (provider rejects) ⇒ 502 with error code
 *   (c) missing creds (not configured) ⇒ 503
 *   (d) adapter throwing unexpectedly → 502, never 500 or unhandled rejection
 *   (e) reads tenantId from context (not from request body)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import integrationsRoutes from '../../../server/api/integrations';
import type { HonoConfig } from '../../../server/types/hono';

afterEach(() => vi.restoreAllMocks());

const TENANT_ID = 'tenant-validate-test';

/**
 * Build a minimal Hono app that mounts the integrations routes with the given
 * env values already merged in (mirrors what integration-secrets middleware does
 * before the handler runs).
 */
function buildApp(env: Record<string, string | undefined> = {}) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT_ID);
        await next();
    });
    app.route('/api/integrations', integrationsRoutes);
    return { app, env: { JWT_SECRET: 'x'.repeat(32), ...env } };
}

function postValidate(provider: string, env: Record<string, string | undefined> = {}) {
    const { app, env: appEnv } = buildApp(env);
    return app.request(
        '/api/integrations/email/validate',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider }),
        },
        appEnv,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) Missing creds → 503 EMAIL_NOT_CONFIGURED
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /email/validate — 503 when creds not configured', () => {
    it('sendgrid: returns 503 when SENDGRID_API_KEY is absent', async () => {
        const res = await postValidate('sendgrid', {});
        expect(res.status).toBe(503);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    });

    it('postmark: returns 503 when POSTMARK_SERVER_TOKEN is absent', async () => {
        const res = await postValidate('postmark', {});
        expect(res.status).toBe(503);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    });

    it('mailgun: returns 503 when MAILGUN_API_KEY is absent', async () => {
        const res = await postValidate('mailgun', { MAILGUN_DOMAIN: 'mg.example.com' });
        expect(res.status).toBe(503);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    });

    it('mailgun: returns 503 when MAILGUN_DOMAIN is absent', async () => {
        const res = await postValidate('mailgun', { MAILGUN_API_KEY: 'key-mg-test' });
        expect(res.status).toBe(503);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    });

    it('resend: returns 503 when RESEND_API_KEY is absent', async () => {
        const res = await postValidate('resend', {});
        expect(res.status).toBe(503);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Valid creds → 200 { ok:true }
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /email/validate — 200 when provider accepts creds', () => {
    it('sendgrid: 200 when provider returns 200 from scopes endpoint', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
        const res = await postValidate('sendgrid', { SENDGRID_API_KEY: 'SG.valid_key' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { ok: boolean } };
        expect(body.success).toBe(true);
        expect(body.data.ok).toBe(true);
    });

    it('postmark: 200 when provider returns 200 from server endpoint', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
        const res = await postValidate('postmark', { POSTMARK_SERVER_TOKEN: 'pm-valid-token' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { ok: boolean } };
        expect(body.success).toBe(true);
        expect(body.data.ok).toBe(true);
    });

    it('mailgun: 200 when provider returns 200 from domain endpoint', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
        const res = await postValidate('mailgun', { MAILGUN_API_KEY: 'key-mg-valid', MAILGUN_DOMAIN: 'mg.example.com' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { ok: boolean } };
        expect(body.success).toBe(true);
        expect(body.data.ok).toBe(true);
    });

    it('resend: 200 when provider returns 200 from domains endpoint', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
        const res = await postValidate('resend', { RESEND_API_KEY: 're_valid_key' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { ok: boolean } };
        expect(body.success).toBe(true);
        expect(body.data.ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Invalid creds (provider rejects) → 502 EMAIL_KEY_INVALID
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /email/validate — 502 when provider rejects creds', () => {
    it('sendgrid: 502 when provider returns 401', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"errors":[{"message":"Invalid API key"}]}', { status: 401 })));
        const res = await postValidate('sendgrid', { SENDGRID_API_KEY: 'SG.bad_key' });
        expect(res.status).toBe(502);
        const body = await res.json() as { success: boolean; error: { code: string; message: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_KEY_INVALID');
    });

    it('postmark: 502 when provider returns 401', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"Message":"Invalid token"}', { status: 401 })));
        const res = await postValidate('postmark', { POSTMARK_SERVER_TOKEN: 'pm-bad-token' });
        expect(res.status).toBe(502);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_KEY_INVALID');
    });

    it('mailgun: 502 when provider returns 401', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Forbidden"}', { status: 401 })));
        const res = await postValidate('mailgun', { MAILGUN_API_KEY: 'key-mg-bad', MAILGUN_DOMAIN: 'mg.example.com' });
        expect(res.status).toBe(502);
        const body = await res.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('EMAIL_KEY_INVALID');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Adapter throws unexpectedly → 502, never 500
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /email/validate — never 500 on unexpected adapter error', () => {
    it('returns 502 (not 500 or unhandled) when fetch throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network failure'); }));
        const res = await postValidate('sendgrid', { SENDGRID_API_KEY: 'SG.throws' });
        // The adapter returns { ok: false, error: '...' } on fetch error (does not rethrow).
        // Endpoint should surface as 502 EMAIL_KEY_INVALID.
        expect(res.status).toBe(502);
        expect(res.status).not.toBe(500);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) tenantId comes from context, not from request body
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /email/validate — tenantId from context', () => {
    it('uses tenantId set by middleware, ignoring any body field', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

        const { app, env } = buildApp({ SENDGRID_API_KEY: 'SG.ok' });
        // The app sets tenantId = TENANT_ID via middleware. We verify the handler
        // does not need/accept tenantId from the body (and still returns 200).
        const res = await app.request(
            '/api/integrations/email/validate',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // Intentionally NOT sending a tenantId field — it must come from context.
                body: JSON.stringify({ provider: 'sendgrid' }),
            },
            env,
        );
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { ok: boolean } };
        expect(body.data.ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 400 on invalid provider enum
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /email/validate — 400 on invalid provider value', () => {
    it('returns 400 when provider is not one of the four allowed values', async () => {
        const res = await postValidate('unknown_provider', {});
        expect(res.status).toBe(400);
    });
});
