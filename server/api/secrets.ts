/**
 * Secret UI化 — GET/PUT /api/admin/secrets
 *
 * Manages all 14 integration API keys stored as AES-256-GCM encrypted JSON
 * in `tenant_configs.encrypted_secrets`. Worker env vars always take precedence
 * (backwards compatibility); DB secrets are the fallback for self-hosted
 * tenants who configure keys via the Settings UI.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { encryptSecrets, decryptSecrets, maskSecret, isMasked } from '../lib/config-crypto';
import { secretsCacheKey } from '../lib/secrets-cache';
import { withMcpMetadata } from '../lib/route-metadata-standards';

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
    'APP_BASE_URL',
] as const;

export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number];

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
    middleware: [requireRole(['owner', 'admin'])],
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
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: { content: { 'application/json': { schema: SecretsInputSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Secrets saved',
        },
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
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: { content: { 'application/json': { schema: SecretsInputSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Secrets saved',
        },
    },
    operationId: 'postIntegrationSecrets',
    description: 'POST alias for PUT /secrets. Accepts the same body.',
}, { scopes: ['admin'], tier: 'extended' }));

export const secretsRoutes = createApiRouter()
    .openapi(getSecretsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        const row = await db
            .select({ encryptedSecrets: tenantConfigs.encryptedSecrets })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        let stored: Record<string, string> = {};
        if (row?.encryptedSecrets) {
            try {
                stored = await decryptSecrets(row.encryptedSecrets, c.env.JWT_SECRET);
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
    .openapi(putSecretsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = drizzle(c.env.DB);

        // 1. Load existing secrets
        const row = await db
            .select({ encryptedSecrets: tenantConfigs.encryptedSecrets })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        let existing: Record<string, string> = {};
        if (row?.encryptedSecrets) {
            try {
                existing = await decryptSecrets(row.encryptedSecrets, c.env.JWT_SECRET);
            } catch {
                // Corrupt data — start fresh
            }
        }

        // 2. Merge: skip masked values and empty strings (no change); only accept known keys
        const allowedKeys = new Set<string>(INTEGRATION_SECRET_KEYS);
        for (const [key, value] of Object.entries(body)) {
            if (!allowedKeys.has(key)) continue;
            if (!value || isMasked(value)) continue;
            // Empty string means "clear this secret"
            if (value.trim() === '') {
                delete existing[key];
            } else {
                existing[key] = value;
            }
        }

        // 3. Encrypt and store
        const cleaned = Object.fromEntries(
            Object.entries(existing).filter(([, v]) => v && v.trim() !== '')
        );

        const encrypted = Object.keys(cleaned).length > 0
            ? await encryptSecrets(cleaned, c.env.JWT_SECRET)
            : null;

        if (row) {
            await db.update(tenantConfigs)
                .set({ encryptedSecrets: encrypted, updatedAt: new Date() })
                .where(eq(tenantConfigs.tenantId, tenantId));
        } else {
            await db.insert(tenantConfigs).values({
                tenantId,
                encryptedSecrets: encrypted,
                updatedAt: new Date(),
            });
        }

        // A-16 — drop the cached encrypted blob so the next request re-reads D1.
        await c.env.TENANT_CACHE?.delete(secretsCacheKey(tenantId)).catch(() => {});

        auditFromContext(c, 'config.secrets.update', 'tenant_config', {
            metadata: { keysUpdated: Object.keys(body).filter(k => allowedKeys.has(k) && body[k] && !isMasked(body[k])) },
        });

        return c.json({ success: true as const }, 200);
    })
    .openapi(postSecretsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = drizzle(c.env.DB);

        let existing: Record<string, string> = {};
        const row = await db
            .select({ encryptedSecrets: tenantConfigs.encryptedSecrets })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        if (row?.encryptedSecrets) {
            try {
                existing = await decryptSecrets(row.encryptedSecrets, c.env.JWT_SECRET);
            } catch { /* start fresh */ }
        }

        const allowedKeys = new Set<string>(INTEGRATION_SECRET_KEYS);
        // Also accept camelCase variants that the existing settings-advanced page sends
        const camelToEnv: Record<string, string> = {
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

        for (const [key, value] of Object.entries(body)) {
            const envKey = camelToEnv[key] ?? key;
            if (!allowedKeys.has(envKey)) continue;
            if (!value || isMasked(value)) continue;
            if (value.trim() === '') {
                delete existing[envKey];
            } else {
                existing[envKey] = value;
            }
        }

        const cleaned = Object.fromEntries(
            Object.entries(existing).filter(([, v]) => v && v.trim() !== '')
        );

        const encrypted = Object.keys(cleaned).length > 0
            ? await encryptSecrets(cleaned, c.env.JWT_SECRET)
            : null;

        if (row) {
            await db.update(tenantConfigs)
                .set({ encryptedSecrets: encrypted, updatedAt: new Date() })
                .where(eq(tenantConfigs.tenantId, tenantId));
        } else {
            await db.insert(tenantConfigs).values({
                tenantId,
                encryptedSecrets: encrypted,
                updatedAt: new Date(),
            });
        }

        // A-16 — drop the cached encrypted blob so the next request re-reads D1.
        await c.env.TENANT_CACHE?.delete(secretsCacheKey(tenantId)).catch(() => {});

        auditFromContext(c, 'config.secrets.update', 'tenant_config');
        return c.json({ success: true as const }, 200);
    });

export type SecretsApi = typeof secretsRoutes;

export default secretsRoutes;
