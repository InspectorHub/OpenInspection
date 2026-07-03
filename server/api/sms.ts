/**
 * Track L (D6/D9) — SMS consent capture + inbound STOP/START webhook.
 *
 * Public router (`smsPublicRoutes`, mounted /api/public):
 *   - GET  /sms/optin-resolve?token=… — resolve an opt-in link token to the
 *     current disclosure + company name (the SSR opt-in page renders this).
 *   - POST /sms/optin-confirm {token}  — record a `granted` event (optin_link).
 *   - POST /sms/inbound        — platform shared-number webhook (D9 shape 1).
 *   - POST /sms/inbound/:tenant — tenant-scoped webhook (D9 shape 2).
 *   The inbound routes are plain Hono `.post` (form-encoded; validated by the
 *   Twilio request signature, not a zod body) and are NOT part of the typed
 *   BFF client — Twilio calls them directly.
 *
 * Admin router (`smsAdminRoutes`, mounted /api/'manager', requireRole owner/'manager'):
 *   - POST /sms/attest {inspectionId}  — inspector attestation (admin) → granted.
 *   - POST /sms/test   {to}            — one-off test send via resolved creds.
 *   - GET  /sms/consent?inspectionId=  — latest client consent for the inspection.
 *
 * Opt-in token mechanism (Step 0 decision): NO new table. The token is a
 * self-describing sealed payload — `<tenantId>~sealToken(contactId)` — resolved
 * via lib/sms/optin-token.ts (reuses the config-crypto tier-2 envelope, same as
 * agreement tokens). See that file for the format rationale.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { contacts, inspections, tenants, tenantConfigs, messagingCompliance } from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { Errors } from '../lib/errors';
import { SmsConsentService } from '../services/sms-consent.service';
import { MessagingComplianceService } from '../services/messaging-compliance.service';
import { TwilioClient } from '../lib/messaging/twilio';
import { ensureClientContact } from '../lib/sms/ensure-client-contact';
import { resolveOptinToken } from '../lib/sms/optin-token';
import { normalizeE164 } from '../lib/sms/phone';
import { loadProviderForTenant, resolveTwilioSource } from '../lib/sms/resolve-twilio';
import { resolveComplianceProvider } from '../lib/sms/resolve-compliance-provider';
import { recordIntegrationTest } from '../lib/integration-test-results';
import { managedSendAllowed } from '../lib/sms/managed-send-gate';
import { PlanQuotaGuard, readTenantTier } from '../features/plan-quota/guard';
import { complianceWebhookUrl } from '../lib/sms/compliance-webhook';
import { getBaseUrl } from '../lib/url';
import { loadTenantSecrets } from '../lib/secrets-cache';
import { maybeMetering } from '../services/metering.service';
import {
    SmsOptinResolveSchema, SmsOptinConfirmSchema, SmsAttestSchema, SmsTestSendSchema, SmsConsentQuerySchema,
    SmsComplianceResponseSchema, SmsComplianceProvisionSchema, SmsComplianceResubmitSchema,
} from '../lib/validations/sms.schema';
import { registerSmsStatusRoute, recordSentStatus, verifyInboundSignature } from '../lib/sms/delivery-status';
import { registerComplianceStatusRoute } from '../lib/sms/compliance-webhook';
import { registerEmailEventsRoute } from '../lib/email/email-events';
import { logger } from '../lib/logger';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

// Re-export for the existing send-site import path (server/api/sms#recordSentStatus).
export { recordSentStatus };

// STOP-set → revoke; START-set → grant; HELP-set → informational auto-reply
// (TCPA/CTIA + Twilio toll-free verification require HELP to respond); anything
// else is logged, not a state change.
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'OPTOUT', 'CANCEL', 'END', 'REVOKE', 'QUIT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'YES']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Brand name for the HELP auto-reply: the tenant's company name in the
 * tenant-scoped inbound shape, else the operator's APP_NAME (self-host) or the
 * platform default. The platform toll-free is shared, so a brand-level name is
 * the correct identity for a HELP reply on the platform shape.
 */
async function helpReplyBrand(c: Context<HonoConfig>, scopeTenantId: string | null): Promise<string> {
    if (scopeTenantId) {
        const db = drizzle(c.env.DB);
        const t = await db.select({ name: tenants.name }).from(tenants)
            .where(eq(tenants.id, scopeTenantId)).get().catch(() => null);
        if (t?.name) return t.name;
    }
    return (c.env as { APP_NAME?: string }).APP_NAME?.trim() || 'Inspector Hub';
}

// ─── Public router ───────────────────────────────────────────────────────────

const optinResolveRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/optin-resolve',
    tags: ['public', 'sms'],
    summary: 'Resolve an SMS opt-in link token to disclosure + company name',
    request: { query: SmsOptinResolveSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.object({
                    companyName: z.string(),
                    disclosureText: z.string(),
                    privacyUrl: z.string().nullable(),
                    termsUrl: z.string().nullable(),
                }),
            }) } },
            description: 'Resolved opt-in context',
        },
    },
    operationId: 'resolveSmsOptin',
    description: 'Resolves the opaque opt-in token to the company name + current SMS disclosure for the public double-opt-in page. Returns 404 on a bad/expired token.',
}, { scopes: ['read'], tier: 'extended' }));

const optinConfirmRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/optin-confirm',
    tags: ['public', 'sms'],
    summary: 'Confirm SMS opt-in (double opt-in) — records a granted consent event',
    request: { body: { content: { 'application/json': { schema: SmsOptinConfirmSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Consent recorded' },
    },
    operationId: 'confirmSmsOptin',
    description: 'Records a granted SMS consent event (captured_via=optin_link) for the contact encoded in the token. Idempotent — confirming twice simply appends a second granted event.',
}, { scopes: ['write'], tier: 'extended' }));

export const smsPublicRoutes = createApiRouter()
    .openapi(optinResolveRoute, async (c) => {
        const { token } = c.req.valid('query');
        const resolved = await resolveOptinToken(token, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS);
        if (!resolved) throw Errors.NotFound('This opt-in link is invalid or has expired.');

        const db = drizzle(c.env.DB);
        const tenant = await db.select({ name: tenants.name }).from(tenants)
            .where(eq(tenants.id, resolved.tenantId)).get();
        if (!tenant) throw Errors.NotFound('This opt-in link is invalid or has expired.');

        const disc = await new SmsConsentService(c.env.DB).currentDisclosure();
        const disclosureText = (disc?.text ?? 'By confirming, you agree to receive appointment and report text messages. Message frequency varies by your inspection activity. Message and data rates may apply. Reply STOP to opt out, HELP for help.')
            .replace(/\{\{\s*company_name\s*\}\}/g, tenant.name);
        const env = c.env as { PRIVACY_URL?: string; TERMS_URL?: string };
        const privacyUrl = env.PRIVACY_URL?.trim() || null;
        const termsUrl = env.TERMS_URL?.trim() || null;
        return c.json({ success: true as const, data: { companyName: tenant.name, disclosureText, privacyUrl, termsUrl } }, 200);
    })
    .openapi(optinConfirmRoute, async (c) => {
        const { token } = c.req.valid('json');
        const resolved = await resolveOptinToken(token, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS);
        if (!resolved) throw Errors.NotFound('This opt-in link is invalid or has expired.');

        await new SmsConsentService(c.env.DB).record(resolved.tenantId, resolved.contactId, 'granted', 'optin_link', {
            ip: c.req.header('CF-Connecting-IP'),
            userAgent: c.req.header('User-Agent'),
        });
        return c.json({ success: true as const }, 200);
    });

// Inbound webhook — plain Hono routes (signature-validated). Not in the typed
// client; the provider (Twilio form-encoded, or Telnyx Ed25519 JSON) posts here
// directly. The platform shape is always Twilio (the shared platform number).
smsPublicRoutes.post('/sms/inbound', (c) =>
    handleInbound(c, { provider: 'twilio', secret: c.env.TWILIO_AUTH_TOKEN ?? '', scopeTenantId: null }));

smsPublicRoutes.post('/sms/inbound/:tenant', async (c) => {
    const slug = c.req.param('tenant');
    const db = drizzle(c.env.DB);
    const tenant = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).get();
    if (!tenant) return c.text('', 404);

    // Decrypt the tenant's own secrets once; the BYO provider chosen in tenant
    // config decides which secret verifies the inbound signature.
    let dec: Record<string, string | undefined> | null = null;
    try {
        dec = await loadTenantSecrets(
            c.env.DB, c.env.TENANT_CACHE, tenant.id, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
        );
    } catch { /* no/undecryptable secrets — fall back below */ }

    const cfg = await db.select({ smsByoProvider: tenantConfigs.smsByoProvider })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenant.id)).get();

    if (cfg?.smsByoProvider === 'telnyx') {
        // BYO Telnyx — verify the inbound webhook with the tenant's base64 Ed25519
        // PUBLIC key. Empty/missing key → handler verify fails closed (403).
        const telnyxPublicKey = dec?.['TELNYX_PUBLIC_KEY'] ?? '';
        return handleInbound(c, { provider: 'telnyx', secret: telnyxPublicKey, scopeTenantId: tenant.id });
    }

    // Twilio (default/null) — the tenant's OWN auth token (when self-configured);
    // fall back to the platform token for a standalone deploy that uses env creds.
    let authToken = c.env.TWILIO_AUTH_TOKEN ?? '';
    const own = dec?.['TWILIO_AUTH_TOKEN'];
    if (own) authToken = own;
    return handleInbound(c, { provider: 'twilio', secret: authToken, scopeTenantId: tenant.id });
});

// Delivery-status webhook (WH-2) — POST /sms/status/:tenant. Verify → dedup →
// parse → last-writer-wins upsert. Implementation lives in lib/sms/delivery-status
// (keeps this router file under the file-size cap; recordSentStatus is re-exported).
registerSmsStatusRoute(smsPublicRoutes);

// Compliance-status webhook (WH-4) — POST /:provider/compliance-status/:tenant.
// Receives provider brand/campaign/TFV status callbacks for managed provisioning.
// Implementation lives in lib/sms/compliance-webhook (keeps this file under size cap).
registerComplianceStatusRoute(smsPublicRoutes);

// Email deliverability webhook (WH-3) — POST /email/:provider/:tenant. Verify →
// dedup → parse → append-only suppression insert for hard bounce / complaint.
// Implementation lives in lib/email/email-events (provider is a path segment).
registerEmailEventsRoute(smsPublicRoutes);

/**
 * Shared inbound handler. Verifies the provider's inbound signature, extracts
 * From/Body (Twilio form params, or Telnyx JSON payload), then applies
 * STOP/START to the matching contact(s) via one shared consent tail.
 * scopeTenantId=null → platform shape (all platform-mode tenants matching From);
 * scopeTenantId set → tenant-scoped shape (that tenant only).
 *
 * Fail-closed: missing/invalid signature, missing key, out-of-tolerance
 * timestamp, or malformed body → 403/200-no-op BEFORE any side effect.
 */
async function handleInbound(
    c: Context<HonoConfig>,
    opts: { provider: 'twilio' | 'telnyx'; secret: string; scopeTenantId: string | null },
): Promise<Response> {
    const verified = await verifyInboundSignature(c, opts);
    if (!verified.ok) return c.text('', verified.status);
    const { rawBody, params } = verified;

    let from: string | null;
    let cmd: string;
    let isHelp: boolean;

    if (opts.provider === 'telnyx') {
        // Parse defensively — a malformed/missing field is acknowledged (200) and
        // never throws. Telnyx does not consume TwiML; a plain 200 is correct.
        let parsed: unknown;
        try { parsed = JSON.parse(rawBody); } catch { return c.text('', 200); }
        const data = (parsed as { data?: { event_type?: unknown; payload?: unknown } } | null)?.data;
        // Only an inbound user reply carries a STOP/START/HELP command.
        if (data?.event_type !== 'message.received') return c.text('', 200);
        const payload = (data as { payload?: { from?: { phone_number?: unknown }; text?: unknown } }).payload;
        const fromRaw = payload?.from?.phone_number;
        const textRaw = payload?.text;
        from = normalizeE164(typeof fromRaw === 'string' ? fromRaw : '');
        cmd = (typeof textRaw === 'string' ? textRaw : '').trim().toUpperCase();
        isHelp = HELP_WORDS.has(cmd);
        // Telnyx HELP: no TwiML — acknowledge with an empty 200. (HELP auto-reply
        // copy is a Twilio/TwiML-specific affordance.)
        if (isHelp) return c.text('', 200);
    } else {
        from = normalizeE164(params.From ?? '');
        cmd = (params.Body ?? '').trim().toUpperCase();
        isHelp = HELP_WORDS.has(cmd);

        // HELP — respond with an informational TwiML message identifying the
        // program. Does not depend on matching a contact (Twilio expects HELP
        // answered regardless).
        if (isHelp) {
            const brand = await helpReplyBrand(c, opts.scopeTenantId);
            const msg = `${brand}: appointment & report text alerts. Message frequency varies by your inspection activity. Msg & data rates may apply. Reply STOP to unsubscribe.`;
            return c.text(`<Response><Message>${escapeXml(msg)}</Message></Response>`, 200, { 'Content-Type': 'text/xml' });
        }
    }

    const isRevoke = STOP_WORDS.has(cmd);
    const isGrant = START_WORDS.has(cmd);

    if (!from) return c.text('<Response/>', 200, { 'Content-Type': 'text/xml' });

    const db = drizzle(c.env.DB);
    // Pull candidate contacts (filtered to a tenant, or all platform-mode tenants),
    // then match on the NORMALIZED phone (stored phones may be unnormalized).
    const candidateRows = await db
        .select({ id: contacts.id, tenantId: contacts.tenantId, phone: contacts.phone })
        .from(contacts)
        .where(opts.scopeTenantId ? eq(contacts.tenantId, opts.scopeTenantId) : undefined)
        .all();

    // For the platform shape, restrict to tenants in platform SMS mode (or unset).
    let allowedTenant: ((tenantId: string) => boolean) = () => true;
    if (!opts.scopeTenantId) {
        const cfgs = await db.select({ tenantId: tenantConfigs.tenantId, smsMode: tenantConfigs.smsMode })
            .from(tenantConfigs).all();
        const ownTenants = new Set(cfgs.filter((r) => r.smsMode === 'own').map((r) => r.tenantId));
        allowedTenant = (tid: string) => !ownTenants.has(tid);
    }

    const matched = candidateRows.filter((r) =>
        normalizeE164(r.phone) === from && allowedTenant(r.tenantId));

    const consentSvc = new SmsConsentService(c.env.DB);
    for (const row of matched) {
        if (isRevoke || isGrant) {
            await consentSvc.record(row.tenantId, row.id, isRevoke ? 'revoked' : 'granted', 'admin', {});
        }
        // NOTE: a non-command inbound body is acknowledged but NOT persisted as an
        // automation_logs row — that table's automation_id/inspection_id are NOT
        // NULL (and the no-FK-references rule forbids fabricating them), and an
        // inbound reply is tied to neither. Two-way conversation surfacing is
        // explicitly out of scope (spec §10); STOP/START consent sync is the only
        // in-scope inbound behavior, and it is handled above.
    }
    return c.text('<Response/>', 200, { 'Content-Type': 'text/xml' });
}

// ─── Admin router ─────────────────────────────────────────────────────────────

const attestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/attest',
    tags: ['admin', 'sms'],
    summary: 'Inspector attestation — confirm the client agreed to receive texts',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsAttestSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Consent recorded' },
    },
    operationId: 'attestSmsConsent',
    description: 'Records a granted SMS consent event (captured_via=admin) for the inspection client contact, auto-creating + linking a contact when the client was free-typed (D6b). The deliberate, accountable basis for phone/in-person bookings.',
}, { scopes: ['admin'], tier: 'extended' }));

const testSendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/test',
    tags: ['admin', 'sms'],
    summary: 'Send a one-off test SMS using the resolved Twilio creds',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsTestSendSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), error: z.string().optional() }) } }, description: 'Send result' },
    },
    operationId: 'testSmsSend',
    description: 'Sends a one-off test SMS to the supplied number using the tenant-resolved Twilio credentials (platform env or tenant own). Fail-closed: returns success=false when no creds resolve or the number is unparseable.',
}, { scopes: ['admin'], tier: 'extended' }));

const smsConfigRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/config',
    tags: ['admin', 'sms'],
    summary: 'Effective SMS sender configuration (mode + source, no secrets)',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true),
            data: z.object({
                mode: z.enum(['platform', 'own']),
                effectiveSource: z.enum(['platform', 'own', 'none']),
            }),
        }) } }, description: 'Effective SMS configuration' },
    },
    operationId: 'getSmsConfig',
    description: 'Returns the tenant SMS sender mode and the effective credential source (platform env, tenant own, or none) WITHOUT leaking any secret values. Drives the "Using platform SMS" / "Using your Twilio" line in Settings.',
}, { scopes: ['read'], tier: 'extended' }));

const consentStatusRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/consent',
    tags: ['admin', 'sms'],
    summary: 'Latest SMS consent status for an inspection client',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { query: SmsConsentQuerySchema },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true),
            data: z.object({ consent: z.enum(['granted', 'revoked', 'none']) }),
        }) } }, description: 'Consent status' },
    },
    operationId: 'getSmsConsentStatus',
    description: 'Returns the latest SMS consent action for the inspection client contact (granted/revoked/none) for the inspection-view status display.',
}, { scopes: ['admin'], tier: 'extended' }));

const complianceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/compliance',
    tags: ['admin', 'sms'],
    summary: 'SMS compliance status — BYO toll-free verification + managed sub-statuses',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: SmsComplianceResponseSchema } }, description: 'Compliance status snapshot' },
    },
    operationId: 'getSmsCompliance',
    description: 'Returns the rolled-up compliance gate plus managed sub-statuses (customerProfileStatus, brandStatus, campaignStatus, tfvStatus, messagingServiceSid, provisionedNumber). For own-mode tenants also reads the live Twilio account. Degrades gracefully (returns stored status or not_started) when credentials are absent or Twilio is unreachable.',
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/manager/sms/compliance/provision — SaaS-only, owner/manager.
const complianceProvisionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/compliance/provision',
    tags: ['admin', 'sms'],
    summary: 'Kick off managed SMS compliance provisioning for this tenant',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsComplianceProvisionSchema } }, required: true } },
    responses: {
        200: { content: { 'application/json': { schema: SmsComplianceResponseSchema } }, description: 'Current compliance status (provision runs in background)' },
        403: { description: 'Not available in standalone mode' },
        409: { description: 'Managed Twilio credentials not configured on this deployment' },
    },
    operationId: 'provisionSmsCompliance',
    description: 'Kicks off the managed TCR/TFV provisioning chain (waitUntil background). Returns the CURRENT stored status immediately — provisioning completes asynchronously. SaaS-only; requires TWILIO_ACCOUNT_SID / TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET env vars.',
}, { scopes: ['admin'], tier: 'extended' }));

// POST /api/manager/sms/compliance/resubmit — SaaS-only, owner/manager.
const complianceResubmitRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/compliance/resubmit',
    tags: ['admin', 'sms'],
    summary: 'Resume managed SMS compliance provisioning from the first missing step',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsComplianceResubmitSchema } }, required: true } },
    responses: {
        200: { content: { 'application/json': { schema: SmsComplianceResponseSchema } }, description: 'Current compliance status after resuming provisioning in background' },
        403: { description: 'Not available in standalone mode' },
        409: { description: 'Managed Twilio credentials not configured on this deployment' },
    },
    operationId: 'resubmitSmsCompliance',
    description: 'Idempotent re-run of the managed provisioning chain (waitUntil background). Skips any step whose SID is already persisted, resuming from the first missing step. SaaS-only; requires TWILIO_ACCOUNT_SID / TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET env vars.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── Shared helper ───────────────────────────────────────────────────────────

/**
 * Fetch the managed sub-status columns for a tenant from messaging_compliance.
 * Returns undefined if no row exists or the query fails.
 */
async function getManagedSubRow(db: ReturnType<typeof drizzle>, tenantId: string): Promise<{
    customerProfileStatus: string | null;
    brandStatus: string | null;
    campaignStatus: string | null;
    tfvStatus: string | null;
    messagingServiceSid: string | null;
    provisionedNumber: string | null;
} | undefined> {
    try {
        return await db.select({
            customerProfileStatus: messagingCompliance.customerProfileStatus,
            brandStatus: messagingCompliance.brandStatus,
            campaignStatus: messagingCompliance.campaignStatus,
            tfvStatus: messagingCompliance.tfvStatus,
            messagingServiceSid: messagingCompliance.messagingResourceSid,
            provisionedNumber: messagingCompliance.provisionedNumber,
        }).from(messagingCompliance).where(eq(messagingCompliance.tenantId, tenantId)).get();
    } catch { return undefined; }
}

export const smsAdminRoutes = createApiRouter()
    .openapi(attestRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { inspectionId } = c.req.valid('json');
        const db = drizzle(c.env.DB);
        const insp = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
        if (!insp) throw Errors.NotFound('Inspection not found.');

        const contactId = await ensureClientContact(c.env.DB, tenantId, insp);
        if (!contactId) throw Errors.BadRequest('This inspection has no client to attest consent for.');

        await new SmsConsentService(c.env.DB).record(tenantId, contactId, 'granted', 'admin', {
            ip: c.req.header('CF-Connecting-IP'),
            userAgent: c.req.header('User-Agent'),
        });
        auditFromContext(c, 'sms.consent.attest', 'inspection', { entityId: inspectionId, metadata: { contactId } });
        return c.json({ success: true as const }, 200);
    })
    .openapi(testSendRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { to } = c.req.valid('json');
        const normalized = normalizeE164(to);
        if (!normalized) return c.json({ success: false, error: 'That phone number could not be parsed. Use an E.164 or US 10-digit format.' }, 200);

        // Managed-send compliance gate — fail-closed for managed tenants until approved.
        // Must run BEFORE the provider call so a blocked managed send makes NO Twilio call.
        // own/platform tenants are always allowed (gate returns immediately).
        const db = drizzle(c.env.DB);
        const testedByUserId = c.get('user')?.sub ?? null;
        let cfgRow: { smsMode: string; smsByoProvider: string | null } | null | undefined;
        try {
            cfgRow = await db.select({ smsMode: tenantConfigs.smsMode, smsByoProvider: tenantConfigs.smsByoProvider })
                .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        } catch { cfgRow = null; }
        const smsProvider = cfgRow?.smsByoProvider ?? 'twilio';
        const smsMode = cfgRow?.smsMode ?? 'platform';
        const gate = await managedSendAllowed(db, c.env, tenantId, smsMode);
        if (!gate.allowed) {
            logger.info('sms.test_send: blocked by managed compliance gate', { tenantId, reason: gate.reason });
            await recordIntegrationTest(db, { tenantId, target: 'sms', provider: smsProvider, ok: false, detail: gate.reason ?? 'managed_not_approved', testedByUserId }).catch(() => {});
            return c.json({ success: false, error: gate.reason ?? 'managed_not_approved' }, 200);
        }

        // Free-tier pre-flight (2026-07) — a free tenant's platform-mode sends
        // (any mode except 'own', which is BYO and uncapped) count against the
        // lifetime sms cap. Runs alongside (not replacing) the managed-compliance
        // gate above, and BEFORE any provider call — a quota block never spends
        // a provider request or a meter record. `tenantTier` is not populated by
        // session-context on this JWT-authenticated route (only the public/
        // fixed-tenant tenant-routing resolvers set it), so fall back to a
        // one-shot tier lookup.
        if (c.var.profile.hasUsageQuota && smsMode !== 'own') {
            const quotaGuard = new PlanQuotaGuard(c.env.DB, { enforced: true, billingPortalUrl: c.var.profile.billingPortalUrl });
            const tier = c.get('tenantTier') ?? await readTenantTier(c.env.DB, tenantId);
            await quotaGuard.checkMessagingQuota(tenantId, tier, 'sms');
        }

        // Use the provider-aware loader so BYO Telnyx tenants route to TelnyxProvider.
        // Twilio tenants: same logic as before (loadProviderForTenant → resolveTwilio).
        // Returns { provider, from } — `from` is populated for Twilio, null for Telnyx
        // (TelnyxProvider reads its own from-number internally).
        const resolved = await loadProviderForTenant(c.env, tenantId);
        if (!resolved) {
            await recordIntegrationTest(db, { tenantId, target: 'sms', provider: smsProvider, ok: false, detail: 'SMS is not configured.', testedByUserId }).catch(() => {});
            return c.json({ success: false, error: 'SMS is not configured. Set your credentials first.' }, 200);
        }

        const sendArgs: { from?: string; to: string; body: string; messagingServiceSid?: string } = {
            to: normalized,
            body: 'This is a test message from your inspection company. SMS is configured correctly.',
        };
        if (resolved.from) sendArgs.from = resolved.from;
        if (resolved.messagingServiceSid) sendArgs.messagingServiceSid = resolved.messagingServiceSid;
        const res = await resolved.provider.sendMessage(sendArgs);
        if (res.ok) {
            // WH-2 — seed a 'sent' delivery-status row for the returned message id
            // (non-fatal; absent id is skipped). The status callback advances it.
            await recordSentStatus(drizzle(c.env.DB), tenantId, res.id, Date.now());
            const metering = maybeMetering(c.env);
            if (metering) {
                const { currentPeriodKey } = await import('../lib/usage/period');
                // Source tagging (2026-07): 'own' mode is BYO — tag its own counter
                // ('sms_byo') so free-cap enforcement never counts a tenant's own
                // Twilio/Telnyx credentials against the platform cap.
                await metering.record(tenantId, smsMode === 'own' ? 'sms_byo' : 'sms', currentPeriodKey(new Date())).catch(() => {});
            }
        }
        auditFromContext(c, 'sms.test_send', 'tenant', { metadata: { ok: res.ok } });
        await recordIntegrationTest(db, {
            tenantId, target: 'sms', provider: smsProvider, ok: res.ok,
            detail: res.ok ? `Test message sent to ${normalized}.` : res.error, testedByUserId,
        }).catch(() => {});
        return res.ok ? c.json({ success: true }, 200) : c.json({ success: false, error: res.error }, 200);
    })
    .openapi(consentStatusRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { inspectionId } = c.req.valid('query');
        const db = drizzle(c.env.DB);
        const insp = await db.select({ clientContactId: inspections.clientContactId }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
        if (!insp) throw Errors.NotFound('Inspection not found.');

        const contactId = insp.clientContactId;
        const latest = contactId ? await new SmsConsentService(c.env.DB).getLatest(tenantId, contactId) : null;
        return c.json({ success: true as const, data: { consent: latest ?? 'none' } }, 200);
    })
    .openapi(smsConfigRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const db = drizzle(c.env.DB);
        const cfg = await db.select({ smsMode: tenantConfigs.smsMode }).from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId)).get().catch(() => null);
        const mode = (cfg?.smsMode as 'platform' | 'own') ?? 'platform';
        // Decrypt the tenant's own Twilio secrets to test PRESENCE only (never echoed).
        const dec = (await loadTenantSecrets(
            c.env.DB, c.env.TENANT_CACHE, tenantId, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
        ).catch(() => null)) ?? {};
        const tenantBag = {
            TWILIO_ACCOUNT_SID: dec['TWILIO_ACCOUNT_SID'],
            TWILIO_AUTH_TOKEN: dec['TWILIO_AUTH_TOKEN'],
            TWILIO_FROM_NUMBER: dec['TWILIO_FROM_NUMBER'],
        };
        const platformBag = {
            TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
            TWILIO_AUTH_TOKEN: c.env.TWILIO_AUTH_TOKEN,
            TWILIO_FROM_NUMBER: c.env.TWILIO_FROM_NUMBER,
        };
        const effectiveSource = resolveTwilioSource(mode, tenantBag, platformBag);
        return c.json({ success: true as const, data: { mode, effectiveSource } }, 200);
    })
    .openapi(complianceRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const db = drizzle(c.env.DB);
        let cfg: { smsMode: string | null } | undefined;
        try { cfg = await db.select({ smsMode: tenantConfigs.smsMode }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get(); }
        catch { cfg = undefined; }
        const mode = (cfg?.smsMode as 'platform' | 'own' | 'managed_shared' | 'managed_dedicated') ?? 'platform';

        const complianceSvc = new MessagingComplianceService(c.env.DB);
        let tollfree: Array<{ sid: string; status: string; phoneNumber: string }> = [];

        // Only attempt a live Twilio read when the tenant is in own mode AND has credentials.
        if (mode === 'own') {
            const dec = (await loadTenantSecrets(
                c.env.DB, c.env.TENANT_CACHE, tenantId, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
            ).catch(() => null)) ?? {};
            const sid = dec['TWILIO_ACCOUNT_SID'];
            const token = dec['TWILIO_AUTH_TOKEN'];
            if (sid && token) {
                const client = new TwilioClient({ sid, token });
                tollfree = await client.tollfree.list().catch(() => []);
                // Persist the snapshot so getStatus reflects the latest read.
                await complianceSvc.syncOwnStatus(tenantId, { sid, token }, client).catch(() => {});
            }
        }

        const stored = await complianceSvc.getStatus(tenantId);
        const managedRow = await getManagedSubRow(db, tenantId);
        return c.json({
            success: true as const,
            data: {
                mode,
                complianceStatus: stored?.complianceStatus ?? null,
                rejectionReason: stored?.rejectionReason ?? null,
                tollfree,
                customerProfileStatus: managedRow?.customerProfileStatus ?? null,
                brandStatus: managedRow?.brandStatus ?? null,
                campaignStatus: managedRow?.campaignStatus ?? null,
                tfvStatus: managedRow?.tfvStatus ?? null,
                messagingServiceSid: managedRow?.messagingServiceSid ?? null,
                provisionedNumber: managedRow?.provisionedNumber ?? null,
            },
        }, 200);
    })
    .openapi(complianceProvisionRoute, async (c) => {
        // SaaS gate: managed provisioning is only available in SaaS mode.
        const profile = c.var.profile;
        if (profile?.mode !== 'saas') {
            return c.json({ success: false as const, error: 'managed_provision_unavailable' }, 403);
        }

        // Managed-eligibility gate: tenant_configs.managed_eligible must be set.
        // managedEligible is set by portal billing sync or a platform admin.
        // Fail-closed: missing row or false → 403 (not eligible).
        const tenantId = c.get('tenantId') as string;
        const db = drizzle(c.env.DB);
        let cfgEligibility: { managedEligible: boolean | null; managedProvider: 'twilio' | 'telnyx' | null } | null | undefined;
        try {
            cfgEligibility = await db
                .select({ managedEligible: tenantConfigs.managedEligible, managedProvider: tenantConfigs.managedProvider })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
        } catch {
            cfgEligibility = null;
        }
        if (!cfgEligibility?.managedEligible) {
            return c.json({ success: false as const, error: 'managed_not_enabled' }, 403);
        }

        // The tenant's managed-compliance carrier choice (default 'twilio').
        const managedProvider = cfgEligibility.managedProvider ?? 'twilio';
        // Combined ISV credential env — the resolver picks creds by providerId.
        const resolverEnv = {
            TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
            TWILIO_API_KEY_SID: c.env.TWILIO_API_KEY_SID,
            TWILIO_API_KEY_SECRET: c.env.TWILIO_API_KEY_SECRET,
            TELNYX_API_KEY: c.env.TELNYX_API_KEY,
        };

        const { businessInfo, channel } = c.req.valid('json');

        const complianceSvc = new MessagingComplianceService(c.env.DB);
        // resolveComplianceProvider throws 'managed_not_configured' when the chosen
        // provider's ISV creds are absent — surface as 409 (same as the legacy gate).
        let provider;
        try {
            provider = resolveComplianceProvider(resolverEnv, managedProvider);
        } catch {
            return c.json({ success: false as const, error: 'managed_not_configured' }, 409);
        }

        // Auto-register the per-tenant compliance webhook as the Trust Hub profile
        // StatusCallbackUrl so Twilio delivers brand/campaign status to our receiver
        // (no manual Console config). Built with getBaseUrl(c) so it byte-matches the
        // URL the webhook validates the Twilio signature against. Best-effort: a missing
        // slug just means no callback (cron poll + manual config still cover it).
        let provSlug: { slug: string | null } | undefined;
        try { provSlug = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).get(); }
        catch { provSlug = undefined; }
        const statusCallbackUrl = provSlug?.slug ? complianceWebhookUrl(getBaseUrl(c), managedProvider, provSlug.slug) : undefined;

        // Fire provision in the background so the request returns immediately.
        const provisionPromise = complianceSvc.provision(tenantId, businessInfo, channel, provider, statusCallbackUrl)
            .catch((err) => {
                logger.error('managed compliance provision failed', { tenantId, channel }, err instanceof Error ? err : new Error(String(err)));
            });

        // `c.executionCtx` getter throws when no execution context is present (unit tests).
        let execCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
        try { execCtx = c.executionCtx; } catch { execCtx = undefined; }
        if (execCtx) execCtx.waitUntil(Promise.resolve(provisionPromise));
        else await provisionPromise;

        auditFromContext(c, 'sms.compliance.provision', 'tenant', { metadata: { channel } });

        // Return the current stored status (provision is async).
        const stored = await complianceSvc.getStatus(tenantId);
        const managedRow = await getManagedSubRow(db, tenantId);
        let cfgRow: { smsMode: string | null } | undefined;
        try { cfgRow = await db.select({ smsMode: tenantConfigs.smsMode }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get(); }
        catch { cfgRow = undefined; }
        const mode = (cfgRow?.smsMode as 'platform' | 'own' | 'managed_shared' | 'managed_dedicated') ?? 'managed_dedicated';
        return c.json({
            success: true as const,
            data: {
                mode,
                complianceStatus: stored?.complianceStatus ?? null,
                rejectionReason: stored?.rejectionReason ?? null,
                tollfree: [],
                customerProfileStatus: managedRow?.customerProfileStatus ?? null,
                brandStatus: managedRow?.brandStatus ?? null,
                campaignStatus: managedRow?.campaignStatus ?? null,
                tfvStatus: managedRow?.tfvStatus ?? null,
                messagingServiceSid: managedRow?.messagingServiceSid ?? null,
                provisionedNumber: managedRow?.provisionedNumber ?? null,
            },
        }, 200);
    })
    .openapi(complianceResubmitRoute, async (c) => {
        // SaaS gate: managed provisioning is only available in SaaS mode.
        const profile = c.var.profile;
        if (profile?.mode !== 'saas') {
            return c.json({ success: false as const, error: 'managed_provision_unavailable' }, 403);
        }

        // Managed-eligibility gate: tenant_configs.managed_eligible must be set.
        // Fail-closed: missing row or false → 403 (not eligible).
        const tenantId = c.get('tenantId') as string;
        const db = drizzle(c.env.DB);
        let cfgEligibility: { managedEligible: boolean | null; managedProvider: 'twilio' | 'telnyx' | null } | null | undefined;
        try {
            cfgEligibility = await db
                .select({ managedEligible: tenantConfigs.managedEligible, managedProvider: tenantConfigs.managedProvider })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
        } catch {
            cfgEligibility = null;
        }
        if (!cfgEligibility?.managedEligible) {
            return c.json({ success: false as const, error: 'managed_not_enabled' }, 403);
        }

        // The tenant's managed-compliance carrier choice (default 'twilio').
        const managedProvider = cfgEligibility.managedProvider ?? 'twilio';
        // Combined ISV credential env — the resolver picks creds by providerId.
        const resolverEnv = {
            TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
            TWILIO_API_KEY_SID: c.env.TWILIO_API_KEY_SID,
            TWILIO_API_KEY_SECRET: c.env.TWILIO_API_KEY_SECRET,
            TELNYX_API_KEY: c.env.TELNYX_API_KEY,
        };

        const complianceSvc = new MessagingComplianceService(c.env.DB);

        // Load the existing row to determine businessInfo for resubmission.
        // Resubmit resumes from the first missing SID — provision() is idempotent.
        // We require a valid stored row (provision must have been called at least once).
        const stored = await complianceSvc.getStatus(tenantId);
        const row = await getManagedSubRow(db, tenantId);
        let cfgRow2: { smsMode: string | null } | undefined;
        try { cfgRow2 = await db.select({ smsMode: tenantConfigs.smsMode }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get(); }
        catch { cfgRow2 = undefined; }
        const mode = (cfgRow2?.smsMode as 'platform' | 'own' | 'managed_shared' | 'managed_dedicated') ?? 'managed_dedicated';

        // Read businessInfo + channel from body (same schema as provision).
        // Known limitation: a REJECTED entity retains its SID, so the idempotent guard in
        // provision() skips it — re-creating a rejected brand/campaign is a follow-up and not in
        // scope here. Resubmit currently resumes only MISSING steps (SID absent in the DB row).
        const { businessInfo, channel } = c.req.valid('json');

        // resolveComplianceProvider throws 'managed_not_configured' when the chosen
        // provider's ISV creds are absent — surface as 409 (same as the legacy gate).
        let provider;
        try {
            provider = resolveComplianceProvider(resolverEnv, managedProvider);
        } catch {
            return c.json({ success: false as const, error: 'managed_not_configured' }, 409);
        }

        // Same auto-registration as provision (only takes effect if step 1 re-runs —
        // i.e. customerProfileSid is still absent on this resumed row).
        let resubSlug: { slug: string | null } | undefined;
        try { resubSlug = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).get(); }
        catch { resubSlug = undefined; }
        const statusCallbackUrl = resubSlug?.slug ? complianceWebhookUrl(getBaseUrl(c), managedProvider, resubSlug.slug) : undefined;

        const provisionPromise = complianceSvc.provision(tenantId, businessInfo, channel, provider, statusCallbackUrl)
            .catch((err) => {
                logger.error('managed compliance resubmit failed', { tenantId, channel }, err instanceof Error ? err : new Error(String(err)));
            });

        // `c.executionCtx` getter throws when no execution context is present (unit tests).
        let execCtx2: Pick<ExecutionContext, 'waitUntil'> | undefined;
        try { execCtx2 = c.executionCtx; } catch { execCtx2 = undefined; }
        if (execCtx2) execCtx2.waitUntil(Promise.resolve(provisionPromise));
        else await provisionPromise;

        auditFromContext(c, 'sms.compliance.resubmit', 'tenant', { metadata: { channel } });

        return c.json({
            success: true as const,
            data: {
                mode,
                complianceStatus: stored?.complianceStatus ?? null,
                rejectionReason: stored?.rejectionReason ?? null,
                tollfree: [],
                customerProfileStatus: row?.customerProfileStatus ?? null,
                brandStatus: row?.brandStatus ?? null,
                campaignStatus: row?.campaignStatus ?? null,
                tfvStatus: row?.tfvStatus ?? null,
                messagingServiceSid: row?.messagingServiceSid ?? null,
                provisionedNumber: row?.provisionedNumber ?? null,
            },
        }, 200);
    });

export type SmsPublicApi = typeof smsPublicRoutes;
export type SmsAdminApi = typeof smsAdminRoutes;
