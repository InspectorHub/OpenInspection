/**
 * Secrets UI — GET/PUT /api/admin/secrets
 *
 * Reads and writes the integration API keys stored as AES-256-GCM encrypted JSON
 * in `tenant_configs.secrets_enc`. Worker env vars always take precedence
 * (backwards compatibility); DB secrets are the fallback for self-hosted
 * tenants who configure keys via the Settings UI. Which keys exist and what a
 * well-formed value looks like lives in `server/lib/secrets-catalog.ts`.
 *
 * This is also the ONLY route that writes a workspace's own AI provider key, so
 * the bring-your-own-key attestation gate lives here rather than beside the AI
 * features that later consume the credential.
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createApiRouter } from '../lib/openapi-router';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { tenantConfigs, tenantAiAttestations } from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { sealSecrets, openSecrets, maskSecret, isMasked } from '../lib/config-crypto';
import { secretsCacheKey } from '../lib/secrets-cache';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import type { HonoConfig } from '../types/hono';
import { getDrizzle } from '../lib/route-helpers';
import { CAMEL_TO_ENV, INTEGRATION_SECRET_KEYS, validateStripeKeyFormats } from '../lib/secrets-catalog';
import { AiKeyAttestationSchema } from '../lib/validations/ai.schema';
import {
    buildAiKeyAttestationRecord,
    isAiKeyAttested,
    type AiKeyAttestation,
} from '../lib/ai/byo-attestation';

const SecretsResponseSchema = z.object({
    success: z.literal(true),
    data: z.record(z.string(), z.string()),
}).openapi('SecretsResponse');

/**
 * Secret values keyed by env name, plus the one non-secret member: the transient
 * `aiKeyAttestation` object that must accompany a NEW tenant-supplied AI key.
 * It is stripped in `saveSecretsImpl` before the merge, never sealed, and never
 * stored in the shape it arrives in.
 */
const SecretsInputSchema = z.record(
    z.string(),
    z.union([z.string(), AiKeyAttestationSchema]).optional(),
).openapi('SecretsInput');

/** Body shape shared by PUT and POST — string secrets plus the transient field. */
type SecretsSaveBody = Record<string, string | AiKeyAttestation | undefined>;

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
 * Shared save implementation behind both PUT and POST. Normalizes camelCase
 * aliases, format-gates + live-verifies Stripe keys (fail-closed 422), then
 * seals the merged set under the tenant's envelope DEK and persists.
 */
export async function saveSecretsImpl(c: Context<HonoConfig>, rawBody: SecretsSaveBody) {
    const tenantId = c.get('tenantId');
    const db = getDrizzle(c);
    const allowedKeys = new Set<string>(INTEGRATION_SECRET_KEYS);

    // The attestation is transient: it is read here, converted into the record
    // written alongside the sealed blob, and never merged into the secret set.
    // Pulling it out first also keeps the merge loop free of non-string values.
    const { aiKeyAttestation, ...rawSecrets } = rawBody;

    // Normalize incoming body to canonical ENV-name keys (drop unknowns).
    const body: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(rawSecrets)) {
        if (typeof value !== 'string' && value !== undefined) continue;
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

    // 0b. BYO AI key — a NEW tenant-supplied key needs the tenant's confirmation
    //     in the SAME request. The provider's terms turn on the service tier of
    //     the billing project behind the key, which is neither carried on the key
    //     nor reported by anything this client calls, so the confirmation is the
    //     only signal available. Refused before the vendor probe below: a save
    //     that will not be stored should not spend a round trip proving the key
    //     works. Fail-closed and no default — a body that says nothing about the
    //     attestation has not attested.
    const incomingGemini = body.GEMINI_API_KEY;
    const newAiKey = incomingGemini && !isMasked(incomingGemini) ? incomingGemini.trim() : '';
    const settingAiKey = newAiKey !== '';
    const attestation = typeof aiKeyAttestation === 'object' ? aiKeyAttestation : undefined;
    if (settingAiKey && !isAiKeyAttested(attestation)) {
        return c.json({
            success: false as const,
            error: {
                code: 'AI_ATTESTATION_REQUIRED',
                message: 'Confirm all three statements about your AI provider account before saving this key.',
                field: 'GEMINI_API_KEY',
            },
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
        // Auth-only probe via the Resend provider — no hand-rolled vendor URL.
        const { ResendProvider } = await import('../lib/email/providers/resend');
        const probe = await new ResendProvider({ apiKey: newResend.trim() }).probeApiKey();
        // Network/null status: not the key's fault — let the save proceed.
        if (!probe.valid) {
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

    if (settingAiKey) {
        const probe = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?pageSize=1&key=${encodeURIComponent(newAiKey)}`,
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

    // 4. Seal. Reuse the existing DEK (rotation converges on write); no secrets
    //    left → clear both columns.
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

    // 5. Store. The attestation record moves with the key, in the same write. Storing
    //    it separately would allow a state where the key is live and the record
    //    is not — the exact state the record exists to rule out. Clearing the key
    //    clears the record: an attestation about a key that is gone attests to
    //    nothing, and leaving it behind would later read as cover for whatever
    //    key is stored next.
    //
    //    Written whenever a confirmation arrives AND a key will exist afterwards
    //    — not only when the key itself is new. A workspace whose key predates
    //    this rule has a working credential and nothing on file for it; without
    //    this, confirming would mean re-pasting a key they already have, and the
    //    runtime refusal would be a dead end. A save carrying NO confirmation
    //    still leaves an existing record untouched, so the masked-resubmit path
    //    neither demands re-confirmation nor re-stamps one nobody made.
    const keyPresentAfterSave = !!cleaned.GEMINI_API_KEY;
    const record = keyPresentAfterSave && isAiKeyAttested(attestation)
        ? buildAiKeyAttestationRecord(new Date())
        : null;
    //    Record and key now live in different tables, so "the same write" is a
    //    `db.batch()` -- D1's only atomic primitive. Two awaited statements
    //    would reopen the exact window above: a key with no record behind it,
    //    or a withdrawal that dropped the record and left the key.
    //
    //    Three shapes of statement where there were three shapes of column
    //    list. The middle one is worth naming: "key present, no confirmation in
    //    this save" emits NO statement, which is what leaves an existing record
    //    alone -- previously an empty spread, and the two agree only because
    //    neither writes.
    const attestationStatement = record
        ? db.insert(tenantAiAttestations)
            .values({
                tenantId,
                provider: record.provider,
                mode: record.mode,
                accountOwner: record.accountOwner,
                termsVersion: record.termsVersion,
                attestedAt: record.attestedAt,
                policyVersion: record.policyVersion,
            })
            .onConflictDoUpdate({
                target: tenantAiAttestations.tenantId,
                set: {
                    provider: record.provider,
                    mode: record.mode,
                    accountOwner: record.accountOwner,
                    termsVersion: record.termsVersion,
                    attestedAt: record.attestedAt,
                    policyVersion: record.policyVersion,
                },
            })
        : keyPresentAfterSave
            ? null
            // No key after this save withdraws the attestation, and DELETE is
            // how that is spelled now. As six nullable columns it was six
            // explicit nulls; the row's absence says the same thing without
            // needing every reader to check that all six agree.
            : db.delete(tenantAiAttestations).where(eq(tenantAiAttestations.tenantId, tenantId));

    const secretsStatement = row
        ? db.update(tenantConfigs)
            .set({ secretsEnc: encrypted, dekEnc, updatedAt: new Date() })
            .where(eq(tenantConfigs.tenantId, tenantId))
        : db.insert(tenantConfigs).values({
            tenantId,
            secretsEnc: encrypted,
            dekEnc,
            updatedAt: new Date(),
        });

    const statements = attestationStatement ? [secretsStatement, attestationStatement] : [secretsStatement];
    await db.batch(statements as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

    // A-16 — drop the cached encrypted blob so the next request re-reads D1.
    await c.env.TENANT_CACHE?.delete(secretsCacheKey(tenantId)).catch(() => {});

    auditFromContext(c, 'config.secrets.update', 'tenant_config', {
        metadata: {
            keysUpdated: Object.keys(body).filter(k => body[k] && !isMasked(body[k])),
            // Versions only — the tenant_configs row is the record; this is the
            // timeline entry that says when it was written and against what.
            ...(record ? { aiKeyAttestation: { termsVersion: record.termsVersion, policyVersion: record.policyVersion } } : {}),
        },
    });

    return c.json({ success: true as const }, 200);
}

const secretsRoutes = createApiRouter()
    .openapi(getSecretsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);

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
