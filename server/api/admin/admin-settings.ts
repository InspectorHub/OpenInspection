// Admin → Settings sub-router (Phase 1.3 split of server/api/admin.ts).
//
// Per-tenant settings surfaces: attention thresholds, dashboard column prefs,
// booking/tenant-config flags, scheduling event-types CRUD, and communication
// (sender/reply-to) config. Route definitions are co-located with their
// `.openapi()` handlers; bodies are byte-identical to the original admin.ts.
// Mounted at `/` by the admin aggregator, preserving the original paths.
//
// `validateCommunicationPatch` lives here (it is the communication route's
// shared, unit-tested rule) and is re-exported from the admin aggregator so
// existing `import { validateCommunicationPatch } from '../api/admin'` callers
// keep resolving.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { userHasCalendarConnection, getCalendarConnection } from '../../lib/calendar/connection';
import { eq } from 'drizzle-orm';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBaseUrl, resolveTenantSlug } from '../../lib/url';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { resolveTenantLegalUrls, type LegalMode } from '../../lib/legal-links';
import {
    AttentionThresholdsSchema,
    AttentionThresholdsResponseSchema,
    ATTENTION_THRESHOLDS_DEFAULTS,
    DashboardColumnPrefsSchema,
    DashboardColumnPrefsResponseSchema,
    TenantConfigPatchSchema,
    CommunicationPatchSchema,
} from '../../lib/validations/admin.schema';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { tenantConfigs } from '../../lib/db/schema';
import { defaultPoliciesOnFirstEnable } from '../../lib/holidays/apply-holiday-policy';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { getDrizzle } from '../../lib/route-helpers';


// --- Attention Thresholds (handoff-decisions §1) ---
//
// Configurable per-team thresholds (in hours) applied to the dashboard
// "Needs Attention" bucket. Stored as JSON on `tenant_configs.attention_thresholds`.

const getAttentionThresholdsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/attention-thresholds',
    tags: ["admin"],
    summary: "List tenant attention thresholds",
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: AttentionThresholdsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "listTenantAttentionThresholds",
    description: "Auto-generated placeholder for listTenantAttentionThresholds (GET /attention-thresholds, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const updateAttentionThresholdsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/attention-thresholds',
    tags: ["admin"],
    summary: "Patch tenant attention threshold",
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: AttentionThresholdsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: AttentionThresholdsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "patchTenantAttentionThreshold",
    description: "Auto-generated placeholder for patchTenantAttentionThreshold (PATCH /attention-thresholds, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


// --- Dashboard Column Prefs (Round-2 backlog #2 — Spectora §5.1 / §E.7) ---
//
// Per-tenant default for the inspection dashboard column visibility set.
// Stored as a JSON array of column ids on `tenant_configs.dashboard_column_prefs`.
// New users on a brand-new device pick this up via GET; user-level overrides
// then live in localStorage on the client. Both endpoints require an
// authenticated owner / admin. All other roles read the same value through
// the dashboard render path — no separate read role gate needed.

const getDashboardColumnsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/dashboard-columns',
    tags: ["admin"],
    summary: 'Get tenant default dashboard column prefs',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: DashboardColumnPrefsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "listTenantDashboardColumns",
    description: "Auto-generated placeholder for listTenantDashboardColumns (GET /dashboard-columns, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const updateDashboardColumnsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/dashboard-columns',
    tags: ["admin"],
    summary: 'Update tenant default dashboard column prefs',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: DashboardColumnPrefsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: DashboardColumnPrefsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "patchTenantDashboardColumn",
    description: "Auto-generated placeholder for patchTenantDashboardColumn (PATCH /dashboard-columns, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


// -----------------------------------------------------------------------------
// GET /api/admin/tenant-config — read booking-related tenant config flags
// -----------------------------------------------------------------------------
const TenantConfigGetResponseSchema = z.object({
    success: z.boolean().describe('Whether the request succeeded'),
    data: z.object({
        conciergeReviewRequired: z.boolean().describe('Whether bookings require concierge review before confirmation'),
        blockUnsignedAgreement: z.boolean().describe('Whether unsigned agreements block inspection start'),
        allowInspectorChoice: z.boolean().describe('Whether the public booking page offers an inspector dropdown'),
        agreementRetentionYears: z.number().int().describe('Years signed agreements are retained before the GDPR retention sweep destroys them (Track I-a). Default 6.'),
        reviewUrl: z.string().nullable().optional().describe('Track J (#122) — company review link, or null.'),
        smsMode: z.enum(['platform', 'own', 'managed_shared', 'managed_dedicated']).describe('Track L (D3) — SMS sender mode.'),
        companyPhone: z.string().nullable().optional().describe('Track L — call-back number rendered as {{company_phone}} in SMS copy.'),
        videoMode: z.enum(['r2', 'stream']).describe('Self-host video backend (default r2). Ignored in SaaS.'),
        smsByoProvider: z.enum(['twilio', 'telnyx']).nullable().describe('BYO SMS provider selection (null = default Twilio).'),
        managedProvider: z.enum(['twilio', 'telnyx']).describe('Managed-compliance carrier (managed_shared/managed_dedicated). Default Twilio.'),
        emailByoProvider: z.enum(['resend', 'sendgrid', 'postmark', 'mailgun']).nullable().describe('BYO email provider selection (null = default Resend).'),
        bookingSlotMode: z.enum(['open', 'fixed']).describe('Public booking slot grid: open = clock-aligned starts; fixed = window-aligned starts (default).'),
        bookingSlotIntervalMin: z.union([z.literal(15), z.literal(30), z.literal(60)]).describe('Slot grid step in minutes (15, 30, or 60). Default 30.'),
        holidayRegion: z.string().nullable().describe('Holiday catalog region (US / US-{ST}) or null when catalog is off.'),
        holidayPublicPolicy: z.enum(['open', 'block', 'advisory']).describe('Public booking policy for catalog closed dates.'),
        holidayInternalPolicy: z.enum(['advisory', 'block']).describe('Internal scheduling policy for catalog closed dates.'),
        bookingConflictPolicy: z.enum(['advisory', 'block']).describe('Internal scheduling policy for double-booking an inspector: advisory warns, block refuses the write.'),
        legalMode: z.enum(['hosted', 'custom']).describe('Privacy/Terms source: OI /legal pages or custom URLs.'),
        customPrivacyUrl: z.string().nullable().describe('Custom Privacy Policy URL when legalMode=custom.'),
        customTermsUrl: z.string().nullable().describe('Custom Terms URL when legalMode=custom.'),
        privacyBody: z.string().nullable().describe('Optional hosted Privacy page body override (plain text/markdown).'),
        termsBody: z.string().nullable().describe('Optional hosted Terms page body override (plain text/markdown).'),
        hostedPrivacyUrl: z.string().nullable().describe('Absolute hosted Privacy URL for copy/TFV (null without tenant slug).'),
        hostedTermsUrl: z.string().nullable().describe('Absolute hosted Terms URL for copy/TFV (null without tenant slug).'),
        effectivePrivacyUrl: z.string().nullable().describe('Effective Privacy URL (hosted or custom).'),
        effectiveTermsUrl: z.string().nullable().describe('Effective Terms URL (hosted or custom).'),
    }).describe('Current tenant configuration flags'),
}).openapi('TenantConfigGetResponse');

const tenantConfigGetRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/tenant-config',
    tags: ["admin"],
    summary: 'Get tenant configuration flags',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: TenantConfigGetResponseSchema.describe('Tenant configuration flags') } },
            description: 'Success',
        },
    },
    operationId: "getTenantConfig",
    description: "Returns booking-related tenant configuration flags (conciergeReviewRequired, blockUnsignedAgreement)."
}, { scopes: ['admin'], tier: 'extended' }));


// -----------------------------------------------------------------------------
// Agent Accounts A3 — concierge review-mode toggle (PATCH /api/admin/tenant-config)
// -----------------------------------------------------------------------------
// Generic patch endpoint scoped to a small allowlist of tenant_configs columns
// the settings UI surfaces directly. `TenantConfigPatchSchema` moved to
// lib/validations/admin/settings.ts — the tenant-config write allowlist derives
// from its shape, and a service cannot import a router module.

const TenantConfigPatchResponseSchema = z.object({
    success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ ok: z.literal(true).describe('TODO describe ok field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('TenantConfigPatchResponse');

const tenantConfigPatchRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/tenant-config',
    tags: ["admin"],
    summary: 'Patch a small allowlist of tenant_configs columns',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: TenantConfigPatchSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: TenantConfigPatchResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Updated',
        },
    },
    operationId: "patchTenantTenantConfig",
    description: "Auto-generated placeholder for patchTenantTenantConfig (PATCH /tenant-config, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/* ---- C-10 ③-D — Scheduling event-types CRUD (over EventService) ---- */
const EventTypeRowSchema = z.object({
    id:                 z.string().describe('Event-type id.'),
    name:               z.string().describe('Display name.'),
    slug:               z.string().describe('URL/identifier slug (unique per tenant).'),
    defaultDurationMin: z.number().nullable().describe('Default duration in minutes.'),
    defaultPriceCents:  z.number().nullable().describe('Default price in cents.'),
    color:              z.string().nullable().describe('Calendar color hex.'),
    sortOrder:          z.number().nullable().describe('Display sort order.'),
    active:             z.boolean().describe('Whether the type is selectable.'),
    followUpDelayHours: z.number().nullable().describe('Hours after a visit is completed before its follow-up is queued. 0 = immediately.'),
});
const EventTypeCreateSchema = z.object({
    name:               z.string().min(1).describe('Display name.'),
    slug:               z.string().min(1).describe('URL/identifier slug (unique per tenant).'),
    defaultDurationMin: z.number().int().optional().describe('Default duration in minutes.'),
    defaultPriceCents:  z.number().int().optional().describe('Default price in cents.'),
    color:              z.string().optional().describe('Calendar color hex.'),
    sortOrder:          z.number().int().optional().describe('Display sort order.'),
    // 0 is legitimate — see the column comment. No `.default()`: the Update
    // schema is this one `.partial()`, and a default would survive that and
    // overwrite a configured delay on any patch that omits the field.
    followUpDelayHours: z.number().int().min(0).max(8760).optional()
        .describe('Hours after a visit is completed before its follow-up is queued. 0 = immediately.'),
}).openapi('EventTypeCreate');
const EventTypeUpdateSchema = EventTypeCreateSchema.partial().openapi('EventTypeUpdate');
const EventTypeIdParam = z.object({ id: z.string().describe('Event-type id.') });

const listEventTypesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/event-types',
    tags: ['admin'],
    summary: 'List scheduling event types',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(z.array(EventTypeRowSchema)) } }, description: 'Event types' },
        401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listEventTypes',
    description: 'Lists the tenant scheduling event types (Radon, Sewer Scope, etc.) used by the calendar + booking flow, ordered by sortOrder.',
}, { scopes: ['admin'], tier: 'extended' }));

const createEventTypeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/event-types',
    tags: ['admin'],
    summary: 'Create a scheduling event type',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: EventTypeCreateSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(EventTypeRowSchema) } }, description: 'Created event type' },
        401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'createEventType',
    description: 'Creates a scheduling event type for the tenant. The slug must be unique per tenant; defaults are applied for omitted duration/price/color/sortOrder.',
}, { scopes: ['admin'], tier: 'extended' }));

const updateEventTypeRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/event-types/{id}',
    tags: ['admin'],
    summary: 'Update a scheduling event type',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: EventTypeIdParam, body: { content: { 'application/json': { schema: EventTypeUpdateSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(EventTypeRowSchema) } }, description: 'Updated event type' },
        401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' }, 404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'updateEventType',
    description: 'Partially updates a scheduling event type by id (tenant-scoped) and returns the fresh row for the settings list.',
}, { scopes: ['admin'], tier: 'extended' }));

const deleteEventTypeRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/event-types/{id}',
    tags: ['admin'],
    summary: 'Delete or deactivate a scheduling event type',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: EventTypeIdParam },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(z.object({ ok: z.literal(true) })) } }, description: 'Deleted/deactivated' },
        401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'deleteEventType',
    description: 'Deletes a scheduling event type when unused, or soft-deactivates it (active=false) when existing inspection events reference it, preserving history.',
}, { scopes: ['admin'], tier: 'extended' }));

/* ---- C-10 ③-D (B-4 / A-7) — Communication config (sender email / reply-to) ---- */
const CommunicationResponseSchema = z.object({
    senderEmail:             z.string().nullable().describe('From: address for tenant transactional email.'),
    replyTo:                 z.string().nullable().describe('Reply-To: header for tenant transactional email.'),
    emailMode:               z.enum(['platform', 'own']).describe('platform = shared Resend; own = tenant Resend.'),
    senderDisplayName:       z.string().nullable().describe('From: display name (override; falls back to companyName).'),
    companyName:                z.string().nullable().describe('Canonical company name (from workspace branding).'),
    legalName:                  z.string().describe('Registered legal entity, already resolved (falls back to companyName). Prefills the SMS compliance wizard.'),
    pointOfContact:          z.enum(['inspector', 'company']).describe('Who client-facing emails come from.'),
    resendConfigured:        z.boolean().describe('Whether a Resend API key is configured (env or tenant secret).'),
    templates:               z.array(z.object({
        id:      z.string().describe('Template id.'),
        name:    z.string().describe('Template name.'),
        trigger: z.string().describe('Automation trigger the template fires on.'),
        active:  z.boolean().describe('Whether the template is active.'),
    })).describe('Email templates (empty until template management ships).'),
    icsUrl:                  z.string().nullable().describe('Calendar subscription (ICS) URL, when a token exists.'),
    googleCalendarConnected: z.boolean().describe('Whether the current user has a calendar_connections row.'),
    googleCalendarCapability: z.enum(['availability_read', 'events_read_write']).nullable()
        .describe('Granted capability for the connected calendar, or null when disconnected.'),
    googleOAuthConfigured: z.boolean().describe('Whether Google OAuth client credentials exist (Worker env or tenant secrets).'),
    googleOAuthMode:       z.enum(['platform', 'own']).describe('platform = shared Worker OAuth app; own = tenant Google OAuth app.'),
});
// `CommunicationPatchSchema` moved to lib/validations/admin/settings.ts for the
// same reason as TenantConfigPatchSchema above.

/** Shared (testable) rule: reply-to is mandatory when emails come from the company,
 *  otherwise replies would fall back to a possibly-unmonitored From address. */
export function validateCommunicationPatch(
  body: { pointOfContact: 'inspector' | 'company'; replyTo: string | null },
): { ok: true } | { ok: false; error: string } {
  if (body.pointOfContact === 'company' && !(body.replyTo ?? '').trim()) {
    return { ok: false, error: 'Reply-to is required when the Point of Contact is your company.' };
  }
  return { ok: true };
}

const getCommunicationRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/communication',
    tags: ['admin'],
    summary: 'Get tenant communication settings',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(CommunicationResponseSchema) } }, description: 'Communication config' },
        401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'getCommunicationConfig',
    description: 'Returns the tenant transactional-email identity (sender + reply-to) plus delivery/integration status flags (Resend configured, ICS URL, Google Calendar connected) for the Settings → Communication page.',
}, { scopes: ['admin'], tier: 'extended' }));

const patchCommunicationRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/communication',
    tags: ['admin'],
    summary: 'Update tenant communication settings',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: CommunicationPatchSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(z.object({ ok: z.literal(true) })) } }, description: 'Saved' },
        401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'updateCommunicationConfig',
    description: 'Persists the tenant From: (senderEmail) and Reply-To: (replyTo) addresses — fixes the B-4/A-7 "Reply-To unsaveable" bug. Either value may be null to clear it.',
}, { scopes: ['admin'], tier: 'extended' }));


const adminSettingsRoutes = createApiRouter()
    .openapi(getAttentionThresholdsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);
        const row = await db.select({ thresholds: tenantConfigs.attentionThresholds })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);
        const thresholds = row[0]?.thresholds ?? ATTENTION_THRESHOLDS_DEFAULTS;
        return c.json({ success: true as const, data: { thresholds } }, 200);
    })
    .openapi(updateAttentionThresholdsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = getDrizzle(c);

        const existing = await db.select({ tenantId: tenantConfigs.tenantId })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);

        if (existing.length === 0) {
            await db.insert(tenantConfigs).values({
                tenantId,
                attentionThresholds: body,
                updatedAt: new Date(),
            });
        } else {
            await db.update(tenantConfigs)
                .set({ attentionThresholds: body, updatedAt: new Date() })
                .where(eq(tenantConfigs.tenantId, tenantId));
        }
        auditFromContext(c, 'config.attention_thresholds.update', 'tenant_config', { metadata: { ...body } });
        return c.json({ success: true as const, data: { thresholds: body } }, 200);
    })
    .openapi(getDashboardColumnsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const columns = await c.var.services.dashboardPrefs.getColumnPrefs(tenantId);
        return c.json({ success: true as const, data: { columns } }, 200);
    })
    .openapi(updateDashboardColumnsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const columns = await c.var.services.dashboardPrefs.setColumnPrefs(tenantId, body.columns);
        auditFromContext(c, 'config.dashboard_columns.update', 'tenant_config', { metadata: { columns } });
        return c.json({ success: true as const, data: { columns } }, 200);
    })
    .openapi(tenantConfigGetRoute, async (c) => {
        const tenantId = c.get('tenantId');
        // getBranding needs explicit defaults (it returns them when no config row
        // exists); we only read config flags here, so the branding defaults are
        // throwaway placeholders. Without this arg a brand-new tenant with no
        // tenant_configs row would TypeError on undefined defaults.
        const config = await c.var.services.branding.getBranding(tenantId, { companyName: '', primaryColor: '', supportEmail: '' }) as Record<string, unknown> | undefined;
        // Best-effort slug for hosted legal URL preview; unit stubs often omit
        // a real D1 tenants table — empty slug just omits the absolute URLs.
        const slug = await resolveTenantSlug(c, tenantId).catch(() => '');
        const legalMode = ((config?.legalMode as LegalMode | undefined) ?? 'hosted');
        const customPrivacyUrl = (config?.customPrivacyUrl as string | null | undefined) ?? null;
        const customTermsUrl = (config?.customTermsUrl as string | null | undefined) ?? null;
        const privacyBody = (config?.privacyBody as string | null | undefined) ?? null;
        const termsBody = (config?.termsBody as string | null | undefined) ?? null;
        const baseUrl = getBaseUrl(c);
        const hosted = slug
            ? resolveTenantLegalUrls(slug, baseUrl, { legalMode: 'hosted' })
            : { privacyUrl: null as string | null, termsUrl: null as string | null };
        const effective = slug
            ? resolveTenantLegalUrls(slug, baseUrl, { legalMode, customPrivacyUrl, customTermsUrl })
            : { privacyUrl: null as string | null, termsUrl: null as string | null };
        return c.json({
            success: true as const,
            data: {
                conciergeReviewRequired: config?.conciergeReviewRequired ?? false,
                blockUnsignedAgreement: config?.blockUnsignedAgreement ?? false,
                allowInspectorChoice: config?.allowInspectorChoice ?? false,
                agreementRetentionYears: config?.agreementRetentionYears ?? 6,
                reviewUrl: config?.reviewUrl ?? null,
                smsMode: (config?.smsMode as 'platform' | 'own' | 'managed_shared' | 'managed_dedicated') ?? 'platform',
                companyPhone: (config?.companyPhone as string | null) ?? null,
                videoMode: (config?.videoMode as 'r2' | 'stream') ?? 'r2',
                smsByoProvider: (config?.smsByoProvider as 'twilio' | 'telnyx' | null) ?? null,
                managedProvider: (config?.managedProvider as 'twilio' | 'telnyx') ?? 'twilio',
                emailByoProvider: (config?.emailByoProvider as 'resend' | 'sendgrid' | 'postmark' | 'mailgun' | null) ?? 'resend',
                bookingSlotMode: config?.bookingSlotMode === 'open' ? 'open' : 'fixed',
                bookingSlotIntervalMin: ([15, 30, 60] as const).includes(
                    config?.bookingSlotIntervalMin as 15 | 30 | 60,
                )
                    ? (config?.bookingSlotIntervalMin as 15 | 30 | 60)
                    : 30,
                holidayRegion: (config?.holidayRegion as string | null | undefined) ?? null,
                holidayPublicPolicy: (['open', 'block', 'advisory'] as const).includes(
                    config?.holidayPublicPolicy as 'open' | 'block' | 'advisory',
                )
                    ? (config?.holidayPublicPolicy as 'open' | 'block' | 'advisory')
                    : 'open',
                holidayInternalPolicy: config?.holidayInternalPolicy === 'block' ? 'block' : 'advisory',
                bookingConflictPolicy: config?.bookingConflictPolicy === 'block' ? 'block' : 'advisory',
                legalMode,
                customPrivacyUrl,
                customTermsUrl,
                privacyBody,
                termsBody,
                hostedPrivacyUrl: hosted.privacyUrl,
                hostedTermsUrl: hosted.termsUrl,
                effectivePrivacyUrl: effective.privacyUrl,
                effectiveTermsUrl: effective.termsUrl,
            },
        }, 200);
    })
    .openapi(tenantConfigPatchRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');

        const update: Partial<typeof tenantConfigs.$inferInsert> = {};
        if (body.conciergeReviewRequired !== undefined) {
            update.conciergeReviewRequired = body.conciergeReviewRequired;
        }
        if (body.blockUnsignedAgreement !== undefined) {
            update.blockUnsignedAgreement = body.blockUnsignedAgreement;
        }
        if (body.allowInspectorChoice !== undefined) {
            update.allowInspectorChoice = body.allowInspectorChoice;
        }
        if (body.agreementRetentionYears !== undefined) {
            update.agreementRetentionYears = body.agreementRetentionYears;
        }
        if (body.reviewUrl !== undefined) {
            update.reviewUrl = body.reviewUrl || null;
        }
        if (body.smsMode !== undefined) {
            const profile = c.var.profile;
            // The real question is whether the `managed_*` SMS modes EXIST on
            // this deployment — i.e. whether anyone can file a 10DLC brand and
            // campaign on the tenant's behalf. That is `hasManagedCompliance`,
            // and it is what the settings page reads to decide whether to offer
            // the choice. `mode === 'standalone'` was a proxy that happens to
            // agree today; reading the capability is what keeps the two agreeing
            // when a deployment stops matching the proxy.
            if (!profile.hasManagedCompliance) {
                // No managed path exists here: ignore any submitted mode and
                // force BYO, which is the only one that can work.
                update.smsMode = 'own';
            } else {
                // SaaS: the schema already excludes 'platform' via z.enum(['own','managed_shared','managed_dedicated']).
                // This guard is the server-side double-check against e.g. a direct API call.
                if ((body.smsMode as string) === 'platform') {
                    throw Errors.BadRequest('Platform SMS is reserved for first-party use.', 'platform_mode_not_allowed');
                }
                update.smsMode = body.smsMode;
            }
        }
        if (body.companyPhone !== undefined) {
            update.companyPhone = body.companyPhone || null;
        }
        if (body.videoMode !== undefined) {
            update.videoMode = body.videoMode;
        }
        if (body.smsByoProvider !== undefined) {
            update.smsByoProvider = body.smsByoProvider;
        }
        if (body.managedProvider !== undefined) {
            update.managedProvider = body.managedProvider;
        }
        if (body.emailByoProvider !== undefined) {
            update.emailByoProvider = body.emailByoProvider;
        }
        if (body.bookingSlotMode !== undefined) {
            update.bookingSlotMode = body.bookingSlotMode;
        }
        if (body.bookingSlotIntervalMin !== undefined) {
            update.bookingSlotIntervalMin = body.bookingSlotIntervalMin;
        }
        if (body.holidayRegion !== undefined) {
            const previous = await c.var.services.branding.getBranding(tenantId, {
                companyName: '', primaryColor: '', supportEmail: '',
            }) as Record<string, unknown> | undefined;
            const wasOff = !previous?.holidayRegion;
            update.holidayRegion = body.holidayRegion;
            // First enable: default public block + internal advisory unless explicitly patched.
            if (wasOff && body.holidayRegion !== null) {
                const defaults = defaultPoliciesOnFirstEnable();
                if (body.holidayPublicPolicy === undefined) update.holidayPublicPolicy = defaults.holidayPublicPolicy;
                if (body.holidayInternalPolicy === undefined) update.holidayInternalPolicy = defaults.holidayInternalPolicy;
            }
        }
        if (body.holidayPublicPolicy !== undefined) {
            update.holidayPublicPolicy = body.holidayPublicPolicy;
        }
        if (body.holidayInternalPolicy !== undefined) {
            update.holidayInternalPolicy = body.holidayInternalPolicy;
        }
        if (body.bookingConflictPolicy !== undefined) {
            update.bookingConflictPolicy = body.bookingConflictPolicy;
        }
        if (body.legalMode !== undefined) {
            update.legalMode = body.legalMode;
        }
        if (body.customPrivacyUrl !== undefined) {
            update.customPrivacyUrl = body.customPrivacyUrl || null;
        }
        if (body.customTermsUrl !== undefined) {
            update.customTermsUrl = body.customTermsUrl || null;
        }
        if (body.privacyBody !== undefined) {
            update.privacyBody = body.privacyBody?.trim() ? body.privacyBody : null;
        }
        if (body.termsBody !== undefined) {
            update.termsBody = body.termsBody?.trim() ? body.termsBody : null;
        }

        const legalTouched =
            body.legalMode !== undefined
            || body.customPrivacyUrl !== undefined
            || body.customTermsUrl !== undefined;
        if (legalTouched) {
            const previous = await c.var.services.branding.getBranding(tenantId, {
                companyName: '', primaryColor: '', supportEmail: '',
            }) as Record<string, unknown> | undefined;
            const nextMode = (update.legalMode ?? previous?.legalMode ?? 'hosted') as LegalMode;
            if (nextMode === 'custom') {
                const privacy = (update.customPrivacyUrl !== undefined
                    ? update.customPrivacyUrl
                    : previous?.customPrivacyUrl) as string | null | undefined;
                const terms = (update.customTermsUrl !== undefined
                    ? update.customTermsUrl
                    : previous?.customTermsUrl) as string | null | undefined;
                if (!privacy?.trim() || !terms?.trim()) {
                    throw Errors.BadRequest(
                        'Custom Privacy and Terms URLs are both required when using your own website.',
                        'legal_custom_urls_required',
                    );
                }
            }
        }

        if (Object.keys(update).length === 0) {
            return c.json({ success: true as const, data: { ok: true as const } }, 200);
        }
        await c.var.services.branding.updateBranding(tenantId, update);

        // A publish is recorded AFTER the write succeeds, and only for a body
        // that actually changed (the service compares the content hash and
        // no-ops on a match). Recording before the write would register a
        // version of text that may never have gone live; recording on every
        // PATCH would mint a version each time a tenant saved an unrelated
        // setting, and a registry that grows a row per form submission stops
        // meaning "the document changed" almost immediately.
        //
        // Non-fatal by design: the version row is evidence about a save, not
        // part of it. Failing the settings save because the historian fell over
        // would lose the change the tenant actually asked for.
        for (const doc of ['privacy', 'terms'] as const) {
            const key = doc === 'privacy' ? 'privacyBody' : 'termsBody';
            if (update[key] === undefined) continue;
            try {
                await c.var.services.legalVersion.recordPublish({
                    tenantId,
                    doc,
                    body: (update[key] as string | null) ?? null,
                    userId: c.get('user')?.sub ?? null,
                });
            } catch (err) {
                logger.error('[legal] failed to record a published version', { doc },
                    err instanceof Error ? err : undefined);
            }
        }

        auditFromContext(c, 'config.tenant_config.patch', 'tenant_config', {
            metadata: update,
        });
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(listEventTypesRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const data = await c.var.services.event.listEventTypes(tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(createEventTypeRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const data = await c.var.services.event.createEventType(tenantId, body);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(updateEventTypeRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        await c.var.services.event.updateEventType(tenantId, id, body);
        const fresh = (await c.var.services.event.listEventTypes(tenantId)).find((t: { id: string }) => t.id === id);
        if (!fresh) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Event type not found' } }, 404);
        return c.json({ success: true as const, data: fresh }, 200);
    })
    .openapi(deleteEventTypeRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.event.deactivateEventType(tenantId, id);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(getCommunicationRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const cfg = await c.var.services.branding.getBranding(tenantId, { companyName: '', primaryColor: '', supportEmail: '' }) as Record<string, unknown>;
        // Resend is "configured" if a key is in env OR stored in tenant secrets.
        // C-15: reads the CANONICAL `secrets_enc` store (ENV-name keys).
        let resendConfigured = !!c.env.RESEND_API_KEY;
        if (!resendConfigured) {
            try {
                const { loadTenantSecrets } = await import('../../lib/secrets-cache');
                const dec = (await loadTenantSecrets(
                    c.env.DB, c.env.TENANT_CACHE, tenantId, c.env.JWT_SECRET,
                    c.env.JWT_SECRET_PREVIOUS,
                ).catch(() => null)) ?? ({} as Record<string, string | undefined>);
                resendConfigured = !!dec.RESEND_API_KEY;
            } catch { /* no decryptable secrets — leave false */ }
        }
        const icsToken = cfg.icsToken as string | null | undefined;
        // Any provider: these fields report whether THIS user has a calendar
        // connected at all. `googleOAuthConfigured` below is the one that is
        // genuinely Google-specific — it gates the Google button.
        const googleCalendarConnected = user?.sub
            ? await userHasCalendarConnection(c.env.DB, tenantId, user.sub)
            : false;
        const calendarRow = user?.sub && googleCalendarConnected
            ? await getCalendarConnection(c.env.DB, tenantId, user.sub)
            : null;
        const integrationCfg = await c.var.services.branding.getIntegrationConfig(tenantId);
        const googleOAuthMode: 'platform' | 'own' = integrationCfg.googleOAuthMode === 'own' ? 'own' : 'platform';
        const { isGoogleOAuthConfigured } = await import('../../lib/calendar/resolve-google-oauth');
        const googleOAuthConfigured = await isGoogleOAuthConfigured(c.env, tenantId);
        return c.json({
            success: true as const,
            data: {
                senderEmail: (cfg.senderEmail as string | null) ?? null,
                replyTo: (cfg.replyTo as string | null) ?? null,
                emailMode: (cfg.emailMode as 'platform' | 'own') ?? 'platform',
                senderDisplayName: (cfg.senderDisplayName as string | null) ?? null,
                companyName: (cfg.companyName as string | null) ?? null,
                legalName: (await c.var.services.branding.getBrand(tenantId)).legalName,
                pointOfContact: (cfg.pointOfContact as 'inspector' | 'company') ?? 'company',
                resendConfigured,
                templates: [],
                icsUrl: icsToken ? `${getBaseUrl(c)}/api/ics/${icsToken}` : null,
                googleCalendarConnected,
                googleCalendarCapability: calendarRow?.capabilities ?? null,
                googleOAuthConfigured,
                googleOAuthMode,
            },
        }, 200);
    })
    .openapi(patchCommunicationRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const check = validateCommunicationPatch({ pointOfContact: body.pointOfContact, replyTo: body.replyTo });
        if (!check.ok) throw Errors.BadRequest(check.error);
        await c.var.services.branding.updateBranding(tenantId, {
            senderEmail: body.senderEmail,
            replyTo: body.replyTo,
            emailMode: body.emailMode,
            senderDisplayName: body.senderDisplayName,
            pointOfContact: body.pointOfContact,
        });
        if (body.googleOAuthMode) {
            await c.var.services.branding.updateIntegrationConfig(tenantId, {
                googleOAuthMode: body.googleOAuthMode,
            });
        }
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    });

export default adminSettingsRoutes;
