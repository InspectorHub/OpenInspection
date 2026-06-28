/**
 * WH-4 — Compliance-status webhook receiver (provider-parameterized).
 *
 * Mounts POST /:provider/compliance-status/:tenant on the public SMS router
 * (full path /api/public/:provider/compliance-status/:tenant).
 *
 * Twilio (and, in Plan 2, Telnyx) posts brand/campaign/TFV status transitions
 * here (configured as a StatusCallback URL during managed provisioning). The
 * handler:
 *   1. Validates :provider is a known ComplianceProviderId (unknown → 404).
 *   2. Builds the provider for webhook verification + parsing (Telnyx → 503).
 *   3. Resolves :tenant slug → tenantId (unknown slug → 404).
 *   4. Verifies the provider's webhook signature fail-closed (no secret or bad
 *      sig → 403, no DB write).
 *   5. Parses the event fields into a typed ComplianceEvent via the provider.
 *   6. Delegates the DB update to MessagingComplianceService.applyComplianceCallback.
 *
 * DRIFT SURFACE — provider-specific payload field names are isolated in each
 * ComplianceProvider.parseCallback implementation. Update only that file when
 * a provider renames a field.
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { tenants } from '../db/schema';
import { getBaseUrl } from '../url';
import { MessagingComplianceService } from '../../services/messaging-compliance.service';
import { logger } from '../logger';
import type { HonoConfig } from '../../types/hono';
import type { ComplianceProvider, ComplianceProviderId } from '../messaging/compliance-provider';
import { TwilioComplianceProvider } from '../messaging/providers/twilio-compliance';
import { TelnyxComplianceProvider } from '../messaging/providers/telnyx-compliance';

// Re-export ComplianceEvent so messaging-compliance.service.ts can keep its
// existing import path without change.
export type { ComplianceEvent } from '../messaging/compliance-provider';

// ComplianceEventEntity kept for backward compat — consumers may also import
// from compliance-provider directly.
export type ComplianceEventEntity = 'brand' | 'campaign' | 'tfv';

/**
 * Build the public compliance-status webhook URL for a tenant slug.
 *
 * Single source of truth for the path, so the StatusCallback auto-registered on
 * the Trust Hub CustomerProfile during provisioning byte-matches the URL this
 * receiver reconstructs for signature validation (`${getBaseUrl(c)}${c.req.path}`).
 * A mismatch here would make every callback fail the signature check (403).
 *
 * Mount prefix `/api/public` + the route path `/:provider/compliance-status/:tenant`.
 */
export function complianceWebhookUrl(
    baseUrl: string,
    providerId: ComplianceProviderId,
    tenantSlug: string,
): string {
    return `${baseUrl}/api/public/${providerId}/compliance-status/${tenantSlug}`;
}

/**
 * Build a ComplianceProvider instance for webhook signature verification and
 * callback parsing. Does NOT require managed-ISV provisioning credentials —
 * verifyWebhookSignature and parseCallback operate on the raw HTTP payload and
 * headers only, not the provider's REST client.
 *
 * Returns null when the provider is registered but not yet implemented for
 * webhook reception (caller should return 503 so stray callbacks fail closed).
 */
function buildWebhookProvider(providerId: ComplianceProviderId): ComplianceProvider | null {
    if (providerId === 'twilio') {
        // The twilio-node client is not used by verifyWebhookSignature or
        // parseCallback, so the empty stand-in is safe for webhook-only use.
        return new TwilioComplianceProvider({} as never);
    }
    if (providerId === 'telnyx') {
        // Telnyx verifyWebhookSignature (Ed25519) + parseCallback do not touch the
        // REST client either — same client-less pattern as Twilio above.
        return new TelnyxComplianceProvider({} as never);
    }
    return null;
}

/**
 * Resolve the verify secret for a provider from env, provider-keyed:
 *   - twilio: the dedicated compliance webhook token, else the platform auth token.
 *   - telnyx: the base64 Ed25519 PUBLIC key (TELNYX_PUBLIC_KEY).
 * Returns undefined when no secret is configured for the resolved provider →
 * caller fails closed (403).
 */
function resolveWebhookSecret(
    providerId: ComplianceProviderId,
    env: { TWILIO_COMPLIANCE_WEBHOOK_TOKEN?: string; TWILIO_AUTH_TOKEN?: string; TELNYX_PUBLIC_KEY?: string },
): string | undefined {
    if (providerId === 'telnyx') return env.TELNYX_PUBLIC_KEY;
    return env.TWILIO_COMPLIANCE_WEBHOOK_TOKEN ?? env.TWILIO_AUTH_TOKEN;
}

/**
 * Mount POST /:provider/compliance-status/:tenant on the public SMS router.
 *
 * The handler validates the provider, verifies the webhook signature fail-closed
 * (verify BEFORE any DB write), and delegates the state-machine update to
 * MessagingComplianceService.applyComplianceCallback (thin route).
 */
export function registerComplianceStatusRoute(router: Hono<HonoConfig>): void {
    router.post('/:provider/compliance-status/:tenant', async (c) => {
        // Step 1: Validate the provider param. Only known ComplianceProviderId
        // values ('twilio' | 'telnyx') are accepted; anything else → 404 so
        // unknown paths do not reveal route structure.
        const rawProvider = c.req.param('provider');
        if (rawProvider !== 'twilio' && rawProvider !== 'telnyx') return c.text('', 404);
        const providerId = rawProvider as ComplianceProviderId;

        // Step 2: Build the provider for webhook purposes. Telnyx managed
        // compliance is Plan 2 — return 503 so stray Telnyx callbacks fail
        // closed rather than 500.
        const complianceProvider = buildWebhookProvider(providerId);
        if (!complianceProvider) return c.text('', 503);

        // Step 3: Resolve tenant slug → tenantId. Unknown slug → 404.
        const slug = c.req.param('tenant');
        const db = drizzle(c.env.DB);
        const tenant = await db.select({ id: tenants.id }).from(tenants)
            .where(eq(tenants.slug, slug)).get();
        if (!tenant) return c.text('', 404);

        // Step 4: Resolve the provider-keyed verify secret (twilio: auth token;
        // telnyx: Ed25519 public key). Missing secret → fail-closed (no secret
        // means no way to verify the signature → reject rather than accept without
        // verification).
        const secret = resolveWebhookSecret(providerId, c.env);
        if (!secret) {
            logger.warn('[compliance-webhook] no signing secret configured — rejecting', { tenantId: tenant.id });
            return c.text('', 403);
        }

        // Read the raw body ONCE (single-consume stream). Parse params for the
        // HMAC verification (Twilio signs the form fields, not the raw body).
        let rawBody: string;
        try { rawBody = await c.req.text(); } catch { return c.text('', 400); }

        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v;

        // Lower-case headers for provider-agnostic header lookup.
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

        const url = `${getBaseUrl(c)}${c.req.path}`;

        // Step 5: Verify the webhook signature fail-closed via the provider's
        // protocol-specific implementation (verify BEFORE any write).
        const ok = await complianceProvider.verifyWebhookSignature({ url, headers, rawBody, params, secret });
        if (!ok) {
            logger.warn('[compliance-webhook] signature verification failed', { tenantId: tenant.id });
            return c.text('', 403);
        }

        // Step 6: Parse the event. Unknown entity → 200 no-op (acknowledged, no
        // DB write). Parsing is delegated to the provider so the field mapping is
        // co-located with the provider implementation.
        const event = complianceProvider.parseCallback(headers, rawBody);
        if (!event) {
            logger.info('[compliance-webhook] unrecognized payload — no-op', { tenantId: tenant.id });
            return c.text('', 200);
        }

        // Step 7: Delegate the state-machine update to the service layer.
        const svc = new MessagingComplianceService(c.env.DB);
        const result = await svc.applyComplianceCallback(tenant.id, event).catch((err) => {
            logger.error('[compliance-webhook] DB update failed', { tenantId: tenant.id, entity: event.entity },
                err instanceof Error ? err : new Error(String(err)));
            return null;
        });

        // Emit a core→portal sync event when the compliance status actually changed.
        // The outbox is the DI-provided UserSyncOutbox interface (di.ts builds it via
        // buildOutbox(), gated on SYNC_QUEUE → undefined in standalone). diMiddleware
        // runs app.use('*'), so c.var.services is populated even on this public route.
        // No portal import here keeps the SaaS-Portal isolation invariant. Fail-soft:
        // an emit failure must never break the 200 response the provider expects.
        if (result?.changed) {
            const outbox = c.var.services?.outbox;
            if (outbox) {
                outbox.append({
                    type: 'io.inspectorhub.tenant.compliance_status_updated',
                    payload: {
                        tenantId: tenant.id,
                        complianceStatus: result.complianceStatus,
                        rejectionReason: result.rejectionReason,
                        updatedAt: Math.floor(Date.now() / 1000),
                    },
                }).catch((err) => {
                    logger.error('[compliance-webhook] outbox emit failed', { tenantId: tenant.id },
                        err instanceof Error ? err : new Error(String(err)));
                });
            }
        }

        return c.text('', 200);
    });
}
