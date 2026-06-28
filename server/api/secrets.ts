/**
 * Secret UI化 — GET/PUT /api/admin/secrets
 *
 * Manages all 14 integration API keys stored as AES-256-GCM encrypted JSON
 * in `tenant_configs.secrets_enc`. Worker env vars always take precedence
 * (backwards compatibility); DB secrets are the fallback for self-hosted
 * tenants who configure keys via the Settings UI.
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { sealSecrets, openSecrets, maskSecret, isMasked } from '../lib/config-crypto';
import { secretsCacheKey } from '../lib/secrets-cache';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import type { HonoConfig } from '../types/hono';

/**
 * Canonical list of all integration secrets configurable via UI.
 * Keys match the Worker env binding names exactly so the middleware can
 * merge them into c.env transparently.
 */
export const INTEGRATION_SECRET_KEYS = [
    'RESEND_API_KEY',
    // SENDER_EMAIL removed (B-14): the From address is not a secret — it lives
    // in the plaintext `tenant_configs.sender_email` column set via the
    // Communication settings form, never in the encrypted secrets store.
    'GEMINI_API_KEY',
    'TURNSTILE_SECRET_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_PLACES_API_KEY',
    'ESTATED_API_KEY',
    'QBO_CLIENT_ID',
    'QBO_CLIENT_SECRET',
    'QBO_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
    'STRIPE_WEBHOOK_SECRET',
    // Track L — Twilio SMS credentials (BYO; platform-default in SaaS via env).
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    // Task 8 (#196) — Telnyx BYO provider credentials.
    'TELNYX_API_KEY',
    'TELNYX_FROM_NUMBER',
    // #wh1 — Telnyx base64 Ed25519 PUBLIC key for inbound webhook verification.
    // No format gate (Ed25519 base64 keys have no stable public prefix, like
    // TELNYX_API_KEY). Encrypted at rest exactly like every other key here.
    'TELNYX_PUBLIC_KEY',
    // #195 — email BYO provider credentials (SendGrid / Postmark / Mailgun).
    // RESEND_API_KEY above covers the Resend path.
    'SENDGRID_API_KEY',
    'POSTMARK_SERVER_TOKEN',
    'MAILGUN_API_KEY',
    'MAILGUN_DOMAIN',
    // #wh3 — per-provider email webhook verification secrets (inbound bounce /
    // complaint receiver POST /api/public/email/:provider/:tenant). No format
    // gate — none of these has a stable public prefix (Svix whsec_ is the secret
    // body for HMAC, the SendGrid value is a base64 P-256 SPKI key, the Postmark
    // token and Mailgun signing key are opaque). Encrypted at rest by membership.
    'RESEND_WEBHOOK_SECRET',
    'SENDGRID_WEBHOOK_PUBLIC_KEY',
    'POSTMARK_WEBHOOK_TOKEN',
    'MAILGUN_SIGNING_KEY',
    'APP_BASE_URL',
] as const;

export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number];

/**
 * Key format rules — the slot a value lands in is inferred from its prefix so
 * a paste into the wrong field is rejected before we attempt a live call.
 * Only keys with a recognizable, STABLE vendor prefix are validated; OAuth
 * client ids/secrets (QBO, Google) and vendor keys without a format guarantee
 * (Places, Estated) are not.
 */
const KEY_FORMATS: Array<{ key: IntegrationSecretKey; re: RegExp; hint: string }> = [
    { key: 'STRIPE_PUBLISHABLE_KEY', re: /^pk_(test|live)_/, hint: 'must start with pk_test_ or pk_live_' },
    { key: 'STRIPE_SECRET_KEY', re: /^(sk|rk)_(test|live)_/, hint: 'must start with sk_test_ / sk_live_ (or a restricted rk_ key)' },
    { key: 'STRIPE_WEBHOOK_SECRET', re: /^whsec_/, hint: 'must start with whsec_' },
    { key: 'RESEND_API_KEY', re: /^re_/, hint: 'must start with re_' },
    { key: 'GEMINI_API_KEY', re: /^AIza/, hint: 'must start with AIza (a Google API key)' },
    // Cloudflare Turnstile secrets: 0x = real, 1x/2x/3x = documented test secrets.
    { key: 'TURNSTILE_SECRET_KEY', re: /^[0-3]x/, hint: 'must start with 0x (or a 1x/2x/3x test secret)' },
    { key: 'APP_BASE_URL', re: /^https?:\/\//, hint: 'must be an http(s):// URL' },
    { key: 'TWILIO_ACCOUNT_SID', re: /^AC[0-9a-fA-F]{32}$/, hint: 'must be an Account SID (starts with AC, 34 chars)' },
    { key: 'TWILIO_FROM_NUMBER', re: /^\+[1-9]\d{6,14}$/, hint: 'must be an E.164 number (e.g. +15551234567)' },
    // TWILIO_AUTH_TOKEN has no stable public prefix — not format-gated.
    { key: 'TELNYX_FROM_NUMBER', re: /^\+[1-9]\d{6,14}$/, hint: 'must be an E.164 number (e.g. +15551234567)' },
    // TELNYX_API_KEY has no stable public prefix — not format-gated.
    { key: 'SENDGRID_API_KEY', re: /^SG\./, hint: 'must start with SG.' },
    { key: 'MAILGUN_DOMAIN', re: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/, hint: 'must be a domain, e.g. mg.yourdomain.com' },
    // POSTMARK_SERVER_TOKEN and MAILGUN_API_KEY have no stable public prefix — not format-gated.
];

/** Returns the first format violation among NEW (non-masked) values, or null. */
export function validateStripeKeyFormats(
    incoming: Record<string, string | undefined>,
): { field: string; message: string } | null {
    for (const { key, re, hint } of KEY_FORMATS) {
        const v = incoming[key];
        if (v && !isMasked(v) && v.trim() !== '' && !re.test(v.trim())) {
            return { field: key, message: `${key} ${hint}.` };
        }
    }
    return null;
}

const SecretsResponseSchema = z.object({
    success: z.literal(true),
    data: z.record(z.string(), z.string()),
}).openapi('SecretsResponse');

const SecretsInputSchema = z.record(z.string(), z.string().optional())
    .openapi('SecretsInput');

// ─── GET /secrets ──────────────────────────────────────────────────────────
const getSecretsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/secrets',
    tags: ['admin'],
    summary: 'Get integration secrets (masked)',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: { 'application/json': { schema: SecretsResponseSchema } },
            description: 'Masked integration secrets',
        },
    },
    operationId: 'getIntegrationSecrets',
    description: 'Returns all 14 integration secrets with values masked for safe display. Empty string means not configured.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── PUT /secrets ──────────────────────────────────────────────────────────
const putSecretsRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/secrets',
    tags: ['admin'],
    summary: 'Save tenant integration API secrets',
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: SecretsInputSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Secrets saved',
        },
        422: { description: 'Key format invalid or Stripe rejected the secret key' },
    },
    operationId: 'putIntegrationSecrets',
    description: 'Save integration secrets. Masked values (containing bullet characters) are skipped — they indicate unchanged fields.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /secrets (alias for PUT — backwards compat with settings-advanced action) ─
const postSecretsRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/secrets',
    tags: ['admin'],
    summary: 'Save integration secrets (POST alias)',
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: SecretsInputSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Secrets saved',
        },
        422: { description: 'Key format invalid or Stripe rejected the secret key' },
    },
    operationId: 'postIntegrationSecrets',
    description: 'POST alias for PUT /secrets. Accepts the same body.',
}, { scopes: ['admin'], tier: 'extended' }));

/**
 * camelCase aliases the legacy settings-advanced page sends. Normalized to the
 * canonical ENV-name keys before validation / merge so the POST alias and PUT
 * share one code path.
 */
const CAMEL_TO_ENV: Record<string, IntegrationSecretKey> = {
    resendApiKey: 'RESEND_API_KEY',
    geminiApiKey: 'GEMINI_API_KEY',
    turnstileSecretKey: 'TURNSTILE_SECRET_KEY',
    googleClientId: 'GOOGLE_CLIENT_ID',
    googleClientSecret: 'GOOGLE_CLIENT_SECRET',
    googlePlacesApiKey: 'GOOGLE_PLACES_API_KEY',
    estatedApiKey: 'ESTATED_API_KEY',
    qboClientId: 'QBO_CLIENT_ID',
    qboClientSecret: 'QBO_CLIENT_SECRET',
    qboWebhookSecret: 'QBO_WEBHOOK_SECRET',
    stripeSecretKey: 'STRIPE_SECRET_KEY',
    stripePublishableKey: 'STRIPE_PUBLISHABLE_KEY',
    stripeWebhookSecret: 'STRIPE_WEBHOOK_SECRET',
    appBaseUrl: 'APP_BASE_URL',
};

/**
 * Shared save implementation behind both PUT and POST. Normalizes camelCase
 * aliases, format-gates + live-verifies Stripe keys (fail-closed 422), then
 * seals the merged set under the tenant's envelope DEK and persists.
 */
async function saveSecretsImpl(c: Context<HonoConfig>, rawBody: Record<string, string | undefined>) {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);
    const allowedKeys = new Set<string>(INTEGRATION_SECRET_KEYS);

    // Normalize incoming body to canonical ENV-name keys (drop unknowns).
    const body: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(rawBody)) {
        const envKey = CAMEL_TO_ENV[key] ?? key;
        if (!allowedKeys.has(envKey)) continue;
        body[envKey] = value;
    }

    // 0. Format gate — reject wrong-slot pastes before any network call.
    const formatErr = validateStripeKeyFormats(body);
    if (formatErr) {
        return c.json({
            success: false as const,
            error: { code: 'INVALID_KEY_FORMAT', message: formatErr.message, field: formatErr.field },
        }, 422);
    }

    // 1. Load + decrypt existing secrets (envelope-aware). Failure → start fresh
    //    (corrupt / key-rotated; admin is re-entering).
    const row = await db
        .select({ secretsEnc: tenantConfigs.secretsEnc, dekEnc: tenantConfigs.dekEnc })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();

    let existing: Record<string, string> = {};
    if (row?.secretsEnc) {
        try {
            existing = await openSecrets(
                row.secretsEnc, row.dekEnc ?? null, tenantId,
                c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
            );
        } catch {
            // Corrupt or key-rotated — start fresh, let admin re-enter
        }
    }

    // 2. Merge: skip masked values and empty strings (no change); empty string
    //    after trim clears the key; only known keys accepted.
    for (const [key, value] of Object.entries(body)) {
        if (!allowedKeys.has(key)) continue;
        if (!value || isMasked(value)) continue;
        if (value.trim() === '') {
            delete existing[key];
        } else {
            // Store TRIMMED — the live-verify below tests the trimmed value, and
            // consumers read the stored value raw; a pasted trailing newline must
            // not diverge the two (verified-ok but broken at payment time).
            existing[key] = value.trim();
        }
    }

    // 3. Live-verify NEW vendor keys BEFORE persisting (fail-closed). Each
    //    probe is a cheap read-only call against the vendor's API; a key that
    //    fails its probe never enters the store.
    const newSk = body.STRIPE_SECRET_KEY;
    if (newSk && !isMasked(newSk) && newSk.trim() !== '') {
        try {
            const { StripeService } = await import('../services/stripe.service');
            await new StripeService(newSk.trim()).getAccount();
        } catch {
            return c.json({
                success: false as const,
                error: {
                    code: 'STRIPE_KEY_INVALID',
                    message: 'Stripe rejected this secret key. Check you copied the full sk_… value from the right mode (test vs live).',
                    field: 'STRIPE_SECRET_KEY',
                },
            }, 422);
        }
    }

    const newResend = body.RESEND_API_KEY;
    if (newResend && !isMasked(newResend) && newResend.trim() !== '') {
        // Auth-only probe: an EMPTY send — bad key → 401/403, valid key
        // (incl. sending-only restricted keys) → 422. No email is sent.
        const probe = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${newResend.trim()}`, 'Content-Type': 'application/json' },
            body: '{}',
        }).catch(() => null);
        // 401/403 = bad key. Other failures (network, 5xx) are NOT the key's
        // fault — let the save proceed rather than blocking on Resend uptime.
        if (probe && (probe.status === 401 || probe.status === 403)) {
            return c.json({
                success: false as const,
                error: {
                    code: 'RESEND_KEY_INVALID',
                    message: 'Resend rejected this API key. Check you copied the full re_… value.',
                    field: 'RESEND_API_KEY',
                },
            }, 422);
        }
    }

    const newGemini = body.GEMINI_API_KEY;
    if (newGemini && !isMasked(newGemini) && newGemini.trim() !== '') {
        const probe = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?pageSize=1&key=${encodeURIComponent(newGemini.trim())}`,
        ).catch(() => null);
        if (probe && (probe.status === 400 || probe.status === 401 || probe.status === 403)) {
            return c.json({
                success: false as const,
                error: {
                    code: 'GEMINI_KEY_INVALID',
                    message: 'Google rejected this Gemini API key. Check you copied the full AIza… value.',
                    field: 'GEMINI_API_KEY',
                },
            }, 422);
        }
    }

    // 4. Seal & store. Reuse the existing DEK (rotation converges on write);
    //    no secrets left → clear both columns.
    const cleaned = Object.fromEntries(
        Object.entries(existing).filter(([, v]) => v && v.trim() !== '')
    );

    let encrypted: string | null = null;
    let dekEnc: string | null = null;
    if (Object.keys(cleaned).length > 0) {
        const sealed = await sealSecrets(
            cleaned, tenantId, c.env.JWT_SECRET, row?.dekEnc, c.env.JWT_SECRET_PREVIOUS,
        );
        encrypted = sealed.blob;
        dekEnc = sealed.dekEnc;
    }

    if (row) {
        await db.update(tenantConfigs)
            .set({ secretsEnc: encrypted, dekEnc, updatedAt: new Date() })
            .where(eq(tenantConfigs.tenantId, tenantId));
    } else {
        await db.insert(tenantConfigs).values({
            tenantId,
            secretsEnc: encrypted,
            dekEnc,
            updatedAt: new Date(),
        });
    }

    // A-16 — drop the cached encrypted blob so the next request re-reads D1.
    await c.env.TENANT_CACHE?.delete(secretsCacheKey(tenantId)).catch(() => {});

    auditFromContext(c, 'config.secrets.update', 'tenant_config', {
        metadata: { keysUpdated: Object.keys(body).filter(k => body[k] && !isMasked(body[k])) },
    });

    return c.json({ success: true as const }, 200);
}

export const secretsRoutes = createApiRouter()
    .openapi(getSecretsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        const row = await db
            .select({ secretsEnc: tenantConfigs.secretsEnc, dekEnc: tenantConfigs.dekEnc })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        let stored: Record<string, string> = {};
        if (row?.secretsEnc) {
            try {
                stored = await openSecrets(
                    row.secretsEnc, row.dekEnc ?? null, tenantId,
                    c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
                );
            } catch {
                // Corrupt or key-rotated — return empty, let admin re-enter
            }
        }

        // Build masked output for every known key
        const masked: Record<string, string> = {};
        for (const key of INTEGRATION_SECRET_KEYS) {
            masked[key] = maskSecret(stored[key] ?? null);
        }

        return c.json({ success: true as const, data: masked }, 200);
    })
    .openapi(putSecretsRoute, (c) => saveSecretsImpl(c, c.req.valid('json')))
    .openapi(postSecretsRoute, (c) => saveSecretsImpl(c, c.req.valid('json')));

export type SecretsApi = typeof secretsRoutes;

export default secretsRoutes;
