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
import { contacts, inspections, tenants, tenantConfigs } from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { Errors } from '../lib/errors';
import { SmsConsentService } from '../services/sms-consent.service';
import { ensureClientContact } from '../lib/sms/ensure-client-contact';
import { resolveOptinToken } from '../lib/sms/optin-token';
import { normalizeE164 } from '../lib/sms/phone';
import { validateTwilioSignature, sendTwilioSms } from '../lib/sms/send-sms';
import { loadTwilioForTenant, resolveTwilioSource } from '../lib/sms/resolve-twilio';
import { loadTenantSecrets } from '../lib/secrets-cache';
import { maybeMetering } from '../services/metering.service';
import {
    SmsOptinResolveSchema, SmsOptinConfirmSchema, SmsAttestSchema, SmsTestSendSchema, SmsConsentQuerySchema,
} from '../lib/validations/sms.schema';
import { getBaseUrl } from '../lib/url';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

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

// Inbound webhook — plain Hono routes (form-encoded, signature-validated). Not
// in the typed client; Twilio posts here directly.
smsPublicRoutes.post('/sms/inbound', (c) =>
    handleInbound(c, { authToken: c.env.TWILIO_AUTH_TOKEN ?? '', scopeTenantId: null }));

smsPublicRoutes.post('/sms/inbound/:tenant', async (c) => {
    const slug = c.req.param('tenant');
    const db = drizzle(c.env.DB);
    const tenant = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).get();
    if (!tenant) return c.text('', 404);
    // The tenant's OWN Twilio auth token (when they self-configured); fall back to
    // the platform token for a standalone single-tenant deploy that uses env creds.
    let authToken = c.env.TWILIO_AUTH_TOKEN ?? '';
    try {
        const dec = await loadTenantSecrets(
            c.env.DB, c.env.TENANT_CACHE, tenant.id, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
        );
        const own = (dec as Record<string, string | undefined> | null)?.['TWILIO_AUTH_TOKEN'];
        if (own) authToken = own;
    } catch { /* fall back to platform token */ }
    return handleInbound(c, { authToken, scopeTenantId: tenant.id });
});

/**
 * Shared inbound handler. Validates the Twilio request signature against
 * `APP_BASE_URL + path`, then applies STOP/START to the matching contact(s).
 * scopeTenantId=null → platform shape (all platform-mode tenants matching From);
 * scopeTenantId set → tenant-scoped shape (that tenant only).
 */
async function handleInbound(
    c: Context<HonoConfig>, opts: { authToken: string; scopeTenantId: string | null },
): Promise<Response> {
    if (!opts.authToken) return c.text('', 403);

    let form: FormData;
    try { form = await c.req.formData(); } catch { return c.text('', 400); }
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : '';

    const url = `${getBaseUrl(c)}${c.req.path}`;
    const presented = c.req.header('X-Twilio-Signature') ?? '';
    const ok = await validateTwilioSignature(opts.authToken, url, params, presented);
    if (!ok) return c.text('', 403);

    const from = normalizeE164(params.From ?? '');
    const cmd = (params.Body ?? '').trim().toUpperCase();
    const isRevoke = STOP_WORDS.has(cmd);
    const isGrant = START_WORDS.has(cmd);

    // HELP — respond with an informational message identifying the program. Does
    // not depend on matching a contact (Twilio expects HELP answered regardless).
    if (HELP_WORDS.has(cmd)) {
        const brand = await helpReplyBrand(c, opts.scopeTenantId);
        const msg = `${brand}: appointment & report text alerts. Message frequency varies by your inspection activity. Msg & data rates may apply. Reply STOP to unsubscribe.`;
        return c.text(`<Response><Message>${escapeXml(msg)}</Message></Response>`, 200, { 'Content-Type': 'text/xml' });
    }

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

        const creds = await loadTwilioForTenant(c.env, tenantId);
        if (!creds) return c.json({ success: false, error: 'SMS is not configured. Set your Twilio credentials first.' }, 200);

        const res = await sendTwilioSms(creds, normalized, 'This is a test message from your inspection company. SMS is configured correctly.');
        if (res.ok) {
            const metering = maybeMetering(c.env);
            if (metering) {
                const { currentPeriodKey } = await import('../lib/usage/period');
                await metering.record(tenantId, 'sms', currentPeriodKey(new Date())).catch(() => {});
            }
        }
        auditFromContext(c, 'sms.test_send', 'tenant', { metadata: { ok: res.ok } });
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
    });

export type SmsPublicApi = typeof smsPublicRoutes;
export type SmsAdminApi = typeof smsAdminRoutes;
