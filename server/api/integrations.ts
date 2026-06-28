/**
 * Design System 0520 subsystem E phase 6 — IntegrationsService routes.
 *
 * `GET /api/integrations/status` returns the six-row snapshot the
 * grid page renders. JWT-guarded; tenant scope from the JWT claim.
 *
 * `POST /api/integrations/stripe/test` — on-demand "Test connection" diagnostic.
 * `GET  /api/integrations/stripe/webhook-log` — recent delivery log (diagnostics).
 * `POST /api/integrations/email/validate` — validate stored BYO email provider creds.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { requireRole } from '../lib/middleware/rbac';
import { EmailValidateBodySchema, EmailValidateOkSchema } from '../lib/validations/integrations.schema';
import { resolveEmailProvider } from '../lib/email/resolve-provider';
import { logger } from '../lib/logger';
import { drizzle } from 'drizzle-orm/d1';
import { recordIntegrationTest, listIntegrationTestResults, type IntegrationTarget } from '../lib/integration-test-results';

/**
 * Single write point for the four "Test connection" probes in this file — keeps
 * the insert+prune logic out of every handler. Best-effort: a logging failure
 * must never change the probe's own HTTP response.
 */
async function logTest(
    env: { DB: D1Database },
    tenantId: string | undefined,
    testedByUserId: string | null,
    target: IntegrationTarget,
    ok: boolean,
    detail: string | null,
    provider?: string | null,
): Promise<void> {
    if (!tenantId) return;
    await recordIntegrationTest(drizzle(env.DB), {
        tenantId, target, ok, detail, provider: provider ?? null, testedByUserId,
    }).catch(() => {});
}

const statusRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/status',
    tags: ['integrations'],
    summary: 'Snapshot of every integration for the active tenant',
    responses: { 200: { description: 'ok' } },
    operationId: 'listIntegrationStatus',
    description: 'Returns a per-integration enabled/configured status row for the active tenant. Drives the integrations overview grid on the settings page.',
}, { scopes: ['read'], tier: 'extended' }));

// ─── POST /stripe/test ────────────────────────────────────────────────────────

const StripeTestResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        accountName: z.string().describe('Display name (or email/id fallback) of the connected Stripe account.'),
        livemode: z.boolean().describe('True when the stored key is a live-mode key (sk_live_/rk_live_ prefix).'),
    }),
}).openapi('StripeTestResponse');

const stripeTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/stripe/test',
    tags: ['integrations'],
    summary: 'Verify the stored Stripe secret key against the live API',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: StripeTestResponseSchema } }, description: 'Key is valid; returns account name and mode' },
        502: { description: 'Stripe rejected the stored key' },
        503: { description: 'No Stripe secret key configured' },
    },
    operationId: 'testStripeConnection',
    description: "Calls Stripe GET /v1/account with the tenant's STORED secret key (merged into env by the integration-secrets middleware) — the on-demand diagnostic behind the settings-page Test connection button. Mode (test/live) is inferred from the key prefix.",
}, { scopes: ['admin'], tier: 'extended' }));

// ─── GET /stripe/webhook-log ──────────────────────────────────────────────────

const WebhookLogEntrySchema = z.object({
    ts: z.string().describe('ISO 8601 delivery timestamp.'),
    eventType: z.string().describe('Stripe event type, or "unknown" for unverifiable payloads.'),
    result: z.enum(['processed', 'received', 'signature_failed', 'tenant_mismatch']).describe('Delivery outcome.'),
});

const stripeWebhookLogRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/stripe/webhook-log',
    tags: ['integrations'],
    summary: 'Recent Stripe webhook deliveries (diagnostics)',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(WebhookLogEntrySchema) }).openapi('StripeWebhookLogResponse') } }, description: 'Up to 20 recent deliveries, newest first' },
    },
    operationId: 'getStripeWebhookLog',
    description: 'Reads the per-tenant KV rolling log written by the Stripe webhook handler. Metadata only (timestamp, event type, result) — payloads are never stored. Backs the settings-page Recent Deliveries panel.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /resend/test + /gemini/test ─────────────────────────────────────────

const resendTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/resend/test',
    tags: ['integrations'],
    summary: 'Verify the stored Resend API key against the live API',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ domains: z.number().describe('Verified sending domains on the account.') }) }).openapi('ResendTestResponse') } }, description: 'Key is valid' },
        502: { description: 'Resend rejected the stored key' },
        503: { description: 'No Resend API key configured' },
    },
    operationId: 'testResendConnection',
    description: "Calls Resend GET /domains with the tenant's STORED API key (merged into env by the integration-secrets middleware) — the on-demand diagnostic behind the Communication settings Test connection button.",
}, { scopes: ['admin'], tier: 'extended' }));

const geminiTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/gemini/test',
    tags: ['integrations'],
    summary: 'Verify the stored Gemini API key against the live API',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ ok: z.literal(true) }) }).openapi('GeminiTestResponse') } }, description: 'Key is valid' },
        502: { description: 'Google rejected the stored key' },
        503: { description: 'No Gemini API key configured' },
    },
    operationId: 'testGeminiConnection',
    description: "Calls the Gemini models list with the tenant's STORED bring-your-own key — the on-demand diagnostic behind the Advanced settings Test connection button.",
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /email/validate ─────────────────────────────────────────────────────

const emailValidateRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/email/validate',
    tags: ['integrations'],
    summary: 'Validate stored BYO email provider credentials',
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: EmailValidateBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: EmailValidateOkSchema } }, description: 'Credentials accepted by the provider' },
        502: { description: 'Provider rejected the stored credentials' },
        503: { description: 'Required credentials not configured' },
    },
    operationId: 'validateEmailProviderCredentials',
    description: [
        "Validates the tenant's stored BYO email provider credentials by calling each",
        'provider\'s validateCredentials() method. Use for sendgrid / postmark / mailgun;',
        'Resend keeps its own /resend/test endpoint (send-only key probe). Creds are',
        'read from c.env after integration-secrets middleware merges them from the',
        'encrypted tenant store.',
    ].join(' '),
}, { scopes: ['admin'], tier: 'extended' }));

// ─── GET /test-results ────────────────────────────────────────────────────────

const TestResultSchema = z.object({
    target: z.enum(['sms', 'email', 'stripe', 'gemini']).describe('Which integration was probed.'),
    provider: z.string().nullable().describe('Provider variant within the target (e.g. twilio/resend); null for single-provider targets.'),
    ok: z.boolean().describe('Whether the probe succeeded.'),
    detail: z.string().nullable().describe('Non-sensitive outcome summary or provider error message.'),
    testedByUserId: z.string().nullable().describe('JWT sub of the user who ran the probe.'),
    testedAt: z.number().describe('Epoch milliseconds when the probe ran.'),
}).openapi('IntegrationTestResult');

const testResultsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/test-results',
    tags: ['integrations'],
    summary: 'Recent "Test connection" outcomes for every integration',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(TestResultSchema) }).openapi('IntegrationTestResultsResponse') } }, description: 'Up to 5 recent results per integration, newest first' },
    },
    operationId: 'listIntegrationTestResults',
    description: 'Returns the retained "Test connection" history for the active tenant (≤5 per integration, newest first). Backs the persisted "Last tested …" status shown next to each Test connection button.',
}, { scopes: ['read'], tier: 'extended' }));

// ─── Router ───────────────────────────────────────────────────────────────────

export const integrationsRoutes = createApiRouter()
    .openapi(statusRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const out = await c.var.services.integrations.status(tenantId);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(testResultsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const data = await listIntegrationTestResults(drizzle(c.env.DB), tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(stripeTestRoute, async (c) => {
        const env = c.env as unknown as Record<string, string | undefined>;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;
        const secretKey = env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            await logTest(c.env, tenantId, uid, 'stripe', false, 'No Stripe secret key is configured.');
            return c.json({ success: false as const, error: { code: 'STRIPE_NOT_CONFIGURED', message: 'No Stripe secret key is configured.' } }, 503);
        }
        try {
            const { StripeService } = await import('../services/stripe.service');
            const { accountName } = await new StripeService(secretKey).getAccount();
            const livemode = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_');
            await logTest(c.env, tenantId, uid, 'stripe', true, `Connected to ${accountName}${livemode ? ' (live mode)' : ' (test mode)'}.`);
            return c.json({ success: true as const, data: { accountName, livemode } }, 200);
        } catch {
            await logTest(c.env, tenantId, uid, 'stripe', false, 'Stripe rejected the stored secret key.');
            return c.json({ success: false as const, error: { code: 'STRIPE_KEY_INVALID', message: 'Stripe rejected the stored secret key.' } }, 502);
        }
    })
    .openapi(stripeWebhookLogRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const { readWebhookLog } = await import('../lib/stripe-webhook-log');
        const entries = await readWebhookLog(c.env.TENANT_CACHE, tenantId);
        return c.json({ success: true as const, data: entries }, 200);
    })
    .openapi(resendTestRoute, async (c) => {
        const env = c.env as unknown as Record<string, string | undefined>;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;
        const key = env.RESEND_API_KEY;
        if (!key) {
            await logTest(c.env, tenantId, uid, 'email', false, 'No Resend API key is configured.', 'resend');
            return c.json({ success: false as const, error: { code: 'RESEND_NOT_CONFIGURED', message: 'No Resend API key is configured.' } }, 503);
        }
        // Auth-only probe: an EMPTY send. A bad key → 401/403; a valid key
        // (including sending-only restricted keys, which 401 on GET /domains)
        // → 422 validation error. No email is ever sent.
        const probe = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: '{}',
        }).catch(() => null);
        if (!probe || probe.status === 401 || probe.status === 403) {
            await logTest(c.env, tenantId, uid, 'email', false, 'Resend rejected the stored API key.', 'resend');
            return c.json({ success: false as const, error: { code: 'RESEND_KEY_INVALID', message: 'Resend rejected the stored API key.' } }, 502);
        }
        // Bonus signal when the key has full access: count verified domains.
        let domains = 0;
        const domRes = await fetch('https://api.resend.com/domains', {
            headers: { Authorization: `Bearer ${key}` },
        }).catch(() => null);
        if (domRes?.ok) {
            const body = (await domRes.json().catch(() => null)) as { data?: unknown[] } | null;
            domains = Array.isArray(body?.data) ? body.data.length : 0;
        }
        await logTest(c.env, tenantId, uid, 'email', true, `Resend key valid${domains > 0 ? ` · ${domains} verified domain${domains === 1 ? '' : 's'}` : ''}.`, 'resend');
        return c.json({ success: true as const, data: { domains } }, 200);
    })
    .openapi(geminiTestRoute, async (c) => {
        const env = c.env as unknown as Record<string, string | undefined>;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;
        const key = env.GEMINI_API_KEY;
        if (!key) {
            await logTest(c.env, tenantId, uid, 'gemini', false, 'No Gemini API key is configured.');
            return c.json({ success: false as const, error: { code: 'GEMINI_NOT_CONFIGURED', message: 'No Gemini API key is configured.' } }, 503);
        }
        const probe = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?pageSize=1&key=${encodeURIComponent(key)}`,
        ).catch(() => null);
        if (!probe || !probe.ok) {
            await logTest(c.env, tenantId, uid, 'gemini', false, 'Google rejected the stored Gemini API key.');
            return c.json({ success: false as const, error: { code: 'GEMINI_KEY_INVALID', message: 'Google rejected the stored Gemini API key.' } }, 502);
        }
        await logTest(c.env, tenantId, uid, 'gemini', true, 'Gemini API key valid.');
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(emailValidateRoute, async (c) => {
        const { provider } = c.req.valid('json');
        const env = c.env as unknown as Record<string, string | undefined>;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;

        // Build creds from env (integration-secrets middleware merges the tenant's
        // stored keys into env before this handler runs — same path as resendTestRoute).
        let creds: { apiKey: string } | { apiKey: string; domain: string } | null = null;

        switch (provider) {
            case 'resend': {
                const key = env.RESEND_API_KEY;
                if (!key) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'No Resend API key is configured.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'No Resend API key is configured.' } }, 503);
                }
                creds = { apiKey: key };
                break;
            }
            case 'sendgrid': {
                const key = env.SENDGRID_API_KEY;
                if (!key) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'No SendGrid API key is configured.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'No SendGrid API key is configured.' } }, 503);
                }
                creds = { apiKey: key };
                break;
            }
            case 'postmark': {
                const token = env.POSTMARK_SERVER_TOKEN;
                if (!token) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'No Postmark Server Token is configured.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'No Postmark Server Token is configured.' } }, 503);
                }
                creds = { apiKey: token };
                break;
            }
            case 'mailgun': {
                const key = env.MAILGUN_API_KEY;
                const domain = env.MAILGUN_DOMAIN;
                if (!key || !domain) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'Mailgun API key and domain are both required.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Mailgun API key and domain are both required.' } }, 503);
                }
                creds = { apiKey: key, domain };
                break;
            }
        }

        try {
            const adapter = resolveEmailProvider(provider, creds);
            const result = adapter.validateCredentials
                ? await adapter.validateCredentials()
                : { ok: true as const };

            if (result.ok) {
                await logTest(c.env, tenantId, uid, 'email', true, `${provider} credentials valid.`, provider);
                return c.json({ success: true as const, data: { ok: true as const } }, 200);
            }
            await logTest(c.env, tenantId, uid, 'email', false, (result as { ok: false; error: string }).error, provider);
            return c.json({
                success: false as const,
                error: { code: 'EMAIL_KEY_INVALID', message: (result as { ok: false; error: string }).error },
            }, 502);
        } catch (err) {
            // Never 500 — surface as 502 with a safe message; do NOT log the key.
            logger.warn('[email-validate] unexpected error during credential check', {
                tenantId,
                provider,
                error: err instanceof Error ? err.message : String(err),
            });
            await logTest(c.env, tenantId, uid, 'email', false, 'Credential validation failed unexpectedly.', provider);
            return c.json({
                success: false as const,
                error: { code: 'EMAIL_KEY_INVALID', message: 'Credential validation failed unexpectedly.' },
            }, 502);
        }
    });

export type IntegrationsApi = typeof integrationsRoutes;
export default integrationsRoutes;
