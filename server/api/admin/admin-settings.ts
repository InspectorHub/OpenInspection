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
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBaseUrl } from '../../lib/url';
import { Errors } from '../../lib/errors';
import {
    AttentionThresholdsSchema,
    AttentionThresholdsResponseSchema,
    ATTENTION_THRESHOLDS_DEFAULTS,
    DashboardColumnPrefsSchema,
    DashboardColumnPrefsResponseSchema,
} from '../../lib/validations/admin.schema';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { tenantConfigs } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";


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
        smsMode: z.enum(['platform', 'own']).describe('Track L (D3) — SMS sender mode.'),
        companyPhone: z.string().nullable().optional().describe('Track L — call-back number rendered as {{company_phone}} in SMS copy.'),
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
// the settings UI surfaces directly. Currently only `conciergeReviewRequired`.
// Adding more keys here in the future stays a one-line allowlist change.
const TenantConfigPatchSchema = z.object({
    conciergeReviewRequired: z.boolean().optional().describe('Whether agent-submitted bookings require owner/admin approval before the client receives a confirmation link.'),
    blockUnsignedAgreement: z.boolean().optional().describe('Whether clients must sign the inspection agreement before a booking is confirmed.'),
    allowInspectorChoice: z.boolean().optional().describe('Toggle the public inspector-choice dropdown (IA-26)'),
    agreementRetentionYears: z.number().int().min(1).max(99).optional().describe('How many years signed agreements / signatures are retained before the GDPR retention sweep destroys them (Track I-a). Integer 1–99; default 6 ≈ UK simple-contract limitation period.'),
    reviewUrl: z.string().url().max(500).nullish().describe('Track J (#122) — company review link (Google/Yelp/Facebook). null/empty clears it.'),
    smsMode: z.enum(['platform', 'own']).optional().describe('Track L (D3) — SMS sender mode: platform env or tenant-own Twilio.'),
    companyPhone: z.string().max(40).nullish().describe('Track L — call-back number shown in SMS copy ({{company_phone}}). null/empty clears it.'),
}).openapi('TenantConfigPatch');

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
});
const EventTypeCreateSchema = z.object({
    name:               z.string().min(1).describe('Display name.'),
    slug:               z.string().min(1).describe('URL/identifier slug (unique per tenant).'),
    defaultDurationMin: z.number().int().optional().describe('Default duration in minutes.'),
    defaultPriceCents:  z.number().int().optional().describe('Default price in cents.'),
    color:              z.string().optional().describe('Calendar color hex.'),
    sortOrder:          z.number().int().optional().describe('Display sort order.'),
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
    senderDisplayName:       z.string().nullable().describe('From: display name (override; falls back to siteName).'),
    siteName:                z.string().nullable().describe('Canonical company name (from workspace branding).'),
    pointOfContact:          z.enum(['inspector', 'company']).describe('Who client-facing emails come from.'),
    resendConfigured:        z.boolean().describe('Whether a Resend API key is configured (env or tenant secret).'),
    templates:               z.array(z.object({
        id:      z.string().describe('Template id.'),
        name:    z.string().describe('Template name.'),
        trigger: z.string().describe('Automation trigger the template fires on.'),
        active:  z.boolean().describe('Whether the template is active.'),
    })).describe('Email templates (empty until template management ships).'),
    icsUrl:                  z.string().nullable().describe('Calendar subscription (ICS) URL, when a token exists.'),
    googleCalendarConnected: z.boolean().describe('Whether a Google Calendar refresh token is stored.'),
});
const CommunicationPatchSchema = z.object({
    senderEmail:          z.string().nullable().describe('From: address, or null to clear.'),
    replyTo:              z.string().nullable().describe('Reply-To: address, or null to clear.'),
    emailMode:            z.enum(['platform', 'own']),
    senderDisplayName:    z.string().nullable(),
    pointOfContact:       z.enum(['inspector', 'company']),
}).openapi('CommunicationPatch');

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


export const adminSettingsRoutes = createApiRouter()
    .openapi(getAttentionThresholdsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
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
        const db = drizzle(c.env.DB);

        const existing = await db.select({ tenantId: tenantConfigs.tenantId })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);

        if (existing.length === 0) {
            await db.insert(tenantConfigs).values({
                tenantId,
                reportTheme: 'modern',
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
        const config = await c.var.services.branding.getBranding(tenantId, { siteName: '', primaryColor: '', supportEmail: '' }) as Record<string, unknown> | undefined;
        return c.json({
            success: true as const,
            data: {
                conciergeReviewRequired: config?.conciergeReviewRequired ?? false,
                blockUnsignedAgreement: config?.blockUnsignedAgreement ?? false,
                allowInspectorChoice: config?.allowInspectorChoice ?? false,
                agreementRetentionYears: config?.agreementRetentionYears ?? 6,
                reviewUrl: config?.reviewUrl ?? null,
                smsMode: (config?.smsMode as 'platform' | 'own') ?? 'platform',
                companyPhone: (config?.companyPhone as string | null) ?? null,
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
            update.smsMode = body.smsMode;
        }
        if (body.companyPhone !== undefined) {
            update.companyPhone = body.companyPhone || null;
        }
        if (Object.keys(update).length === 0) {
            return c.json({ success: true as const, data: { ok: true as const } }, 200);
        }
        await c.var.services.branding.updateBranding(tenantId, update);
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
        const cfg = await c.var.services.branding.getBranding(tenantId, { siteName: '', primaryColor: '', supportEmail: '' }) as Record<string, unknown>;
        // Resend is "configured" if a key is in env OR stored in tenant secrets.
        // C-15: reads the CANONICAL `encrypted_secrets` store (ENV-name keys).
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
        return c.json({
            success: true as const,
            data: {
                senderEmail: (cfg.senderEmail as string | null) ?? null,
                replyTo: (cfg.replyTo as string | null) ?? null,
                emailMode: (cfg.emailMode as 'platform' | 'own') ?? 'platform',
                senderDisplayName: (cfg.senderDisplayName as string | null) ?? null,
                siteName: (cfg.siteName as string | null) ?? null,
                pointOfContact: (cfg.pointOfContact as 'inspector' | 'company') ?? 'company',
                resendConfigured,
                templates: [],
                icsUrl: icsToken ? `${getBaseUrl(c)}/api/ics/${icsToken}` : null,
                googleCalendarConnected: !!cfg.googleRefreshToken,
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
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    });

export type AdminSettingsApi = typeof adminSettingsRoutes;
export default adminSettingsRoutes;
