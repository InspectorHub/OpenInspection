/**
 * WH-3 — tenant email deliverability webhook receiver.
 *
 * Mounts POST /email/:provider/:tenant on the public router. The provider is a
 * PATH segment (never sniffed from headers/body). For a request:
 *   - coerce/validate :provider against EMAIL_BYO_PROVIDERS (unknown → 404);
 *   - resolve :tenant slug → tenant id (unknown → 404);
 *   - load THIS tenant's webhook verification secret for THIS provider from the
 *     encrypted secrets (RESEND_WEBHOOK_SECRET / SENDGRID_WEBHOOK_PUBLIC_KEY /
 *     POSTMARK_WEBHOOK_TOKEN / MAILGUN_SIGNING_KEY);
 *   - build the provider-agnostic EmailWebhookContext and verify FAIL-CLOSED:
 *     a bad/missing signature → 403 BEFORE any DB write (never throws);
 *   - parse the verified body into normalized events and, per event, dedup on a
 *     stable id (processed_webhook_events) then INSERT an append-only
 *     email_suppressions row for a hard bounce or a complaint only. Soft bounces
 *     and `delivered` never suppress, but are still dedup-recorded so a provider
 *     retry is a guaranteed no-op.
 *
 * Every handled event (including no-ops and duplicates) returns 200. The ONLY
 * non-200 outcome is a signature/secret failure (403) and an unknown
 * provider/tenant (404). A malformed body yields no parsed events → 200.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { tenants, emailSuppressions, processedWebhookEvents } from '../db/schema';
import { loadTenantSecrets } from '../secrets-cache';
import {
    EMAIL_BYO_PROVIDERS,
    resolveEmailProvider,
    type EmailByoProvider,
} from './resolve-provider';
import type { EmailWebhookContext } from './provider';
import type { HonoConfig } from '../../types/hono';

/**
 * The encrypted-secret key that holds each provider's inbound webhook
 * verification material (see server/api/secrets.ts INTEGRATION_SECRET_KEYS).
 * Resend (Svix HMAC) → the whsec_ signing secret; SendGrid → the base64 P-256
 * SPKI public key; Postmark → the shared token; Mailgun → the signing key.
 */
const WEBHOOK_SECRET_KEY: Record<EmailByoProvider, string> = {
    resend: 'RESEND_WEBHOOK_SECRET',
    sendgrid: 'SENDGRID_WEBHOOK_PUBLIC_KEY',
    postmark: 'POSTMARK_WEBHOOK_TOKEN',
    mailgun: 'MAILGUN_SIGNING_KEY',
};

/**
 * Dummy creds to construct the adapter purely for its verify/parse methods —
 * neither path reads the API key (Mailgun additionally needs a `domain` field to
 * satisfy its constructor type, but does not use it for verify/parse either).
 */
function dummyCreds(provider: EmailByoProvider): { apiKey: string } | { apiKey: string; domain: string } {
    return provider === 'mailgun' ? { apiKey: '', domain: '' } : { apiKey: '' };
}

/** Narrow an untrusted :provider segment to a known provider, else null. */
function parseProviderParam(value: string): EmailByoProvider | null {
    return (EMAIL_BYO_PROVIDERS as ReadonlyArray<string>).includes(value)
        ? (value as EmailByoProvider)
        : null;
}

export function registerEmailEventsRoute(router: Hono<HonoConfig>): void {
    router.post('/email/:provider/:tenant', async (c) => {
        const provider = parseProviderParam(c.req.param('provider'));
        if (!provider) return c.text('', 404);

        const slug = c.req.param('tenant');
        const db = drizzle(c.env.DB);
        const tenant = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).get();
        if (!tenant) return c.text('', 404);

        // Load the tenant's own encrypted secrets; the webhook secret for THIS
        // provider verifies the inbound signature. Missing/undecryptable → empty
        // string → the adapter's verify fails closed (403) below.
        let dec: Record<string, string | undefined> | null = null;
        try {
            dec = await loadTenantSecrets(
                c.env.DB, c.env.TENANT_CACHE, tenant.id, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
            );
        } catch { /* no/undecryptable secrets — fall back to empty secret below */ }
        const secret = dec?.[WEBHOOK_SECRET_KEY[provider]] ?? '';

        // Read the raw body ONCE — every signing scheme signs the exact bytes.
        let rawBody: string;
        try { rawBody = await c.req.text(); } catch { return c.text('', 400); }

        // Lower-cased headers + parsed query for the provider-agnostic context.
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        const query = c.req.query();
        // Optional test seam: pin the anti-replay clock (shared WEBHOOK_NOW_MS env
        // seam, identical to WH-2's delivery-status receiver).
        const nowMs = (c.env as { WEBHOOK_NOW_MS?: number }).WEBHOOK_NOW_MS;
        const ctx: EmailWebhookContext = { rawBody, headers, secret, query, ...(nowMs !== undefined ? { nowMs } : {}) };

        const adapter = resolveEmailProvider(provider, dummyCreds(provider));
        const ok = await adapter.verifyWebhookSignature(ctx);
        if (!ok) return c.text('', 403); // fail-closed BEFORE any DB write

        const recordedAt = nowMs ?? Date.now();
        const events = adapter.parseWebhookEvents(rawBody);
        for (const ev of events) {
            // Idempotency: a stable per-event key. processed_webhook_events is a
            // platform-global ledger, but a BYO provider message id is only unique
            // WITHIN that tenant's provider account — two tenants on the same
            // provider could in principle reuse an id. Scope the key by tenant so a
            // legitimate event for one tenant is never deduped as another's. Also
            // scope by provider + type (providerEventId can repeat across event
            // types from some providers).
            const eventId = `${tenant.id}:${provider}:${ev.type}:${ev.providerEventId}`;
            try {
                await db.insert(processedWebhookEvents)
                    .values({ eventId, receivedAt: new Date(recordedAt) }).run();
            } catch {
                // Unique-violation ⇒ already processed (provider retry) ⇒ skip THIS event.
                continue;
            }

            // Suppress ONLY a hard bounce or a complaint. Soft bounces + delivered
            // are dedup-recorded above (so a retry is a no-op) but never suppress.
            const reason: 'hard_bounce' | 'complaint' | null =
                ev.type === 'bounced' && ev.hardBounce === true ? 'hard_bounce'
                : ev.type === 'complained' ? 'complaint'
                : null;
            if (!reason) continue;

            const email = ev.email.trim().toLowerCase();
            if (!email) continue;

            try {
                await db.insert(emailSuppressions).values({
                    id: crypto.randomUUID(),
                    tenantId: tenant.id,
                    email,
                    reason,
                    sourceProvider: provider,
                    providerEventId: ev.providerEventId || null,
                    createdAt: new Date(recordedAt),
                }).run();
            } catch { /* append-only side-write; never fail the ack */ }
        }

        return c.text('', 200);
    });
}
