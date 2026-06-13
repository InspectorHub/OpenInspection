/**
 * Email-template CRUD + preview API — GET/PUT/POST /api/admin/email-templates
 *
 * Tenant-scoped overrides for the 17 editable registry templates.
 * Phase 3 of the email-templates feature.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { REGISTRY, getDescriptor } from '../lib/email-templates/registry';
import { EmailTemplateService } from '../services/email-template.service';
import { EmailTemplateRenderer } from '../lib/email-templates/renderer';
import { sampleDataFor } from '../lib/email-templates/sample-data';
import { BrandingService } from '../services/branding.service';
import { SaveEmailTemplateSchema, PreviewEmailTemplateSchema } from '../lib/validations/email-template.schema';

// ─── Response schemas ──────────────────────────────────────────────────────

const TemplateListItemSchema = z.object({
    trigger: z.string(),
    name: z.string(),
    category: z.string(),
    required: z.boolean(),
    enabled: z.boolean(),
    isCustomized: z.boolean(),
    subject: z.string(),
});

const TemplateListResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(TemplateListItemSchema),
}).openapi('EmailTemplateListResponse');

const BlockValueSchema = z.object({
    key: z.string(),
    label: z.string(),
    multiline: z.boolean(),
    value: z.string(),
});

const VariableSchema = z.object({
    name: z.string(),
    desc: z.string(),
});

const TemplateDetailResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        trigger: z.string(),
        name: z.string(),
        required: z.boolean(),
        enabled: z.boolean(),
        subject: z.string(),
        blocks: z.array(BlockValueSchema),
        variables: z.array(VariableSchema),
    }),
}).openapi('EmailTemplateDetailResponse');

const OkResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({ ok: z.literal(true) }),
}).openapi('EmailTemplateOkResponse');

const PreviewResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        subject: z.string(),
        html: z.string(),
    }),
}).openapi('EmailTemplatePreviewResponse');

const TriggerParamSchema = z.object({
    trigger: z.string().openapi({ description: 'Email template trigger identifier (e.g. report-ready, agreement-request)' }),
});

// ─── GET /email-templates ──────────────────────────────────────────────────
const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/email-templates',
    tags: ['admin'],
    summary: 'List editable email templates',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: { 'application/json': { schema: TemplateListResponseSchema } },
            description: 'List of 17 editable templates merged with tenant overrides',
        },
    },
    operationId: 'listEmailTemplates',
    description: 'Returns all 17 editable email templates merged with the tenant\'s saved overrides. The password-reset template (non-editable) is excluded.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── GET /email-templates/{trigger} ───────────────────────────────────────
const getRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/email-templates/{trigger}',
    tags: ['admin'],
    summary: 'Get email template detail',
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: TriggerParamSchema,
    },
    responses: {
        200: {
            content: { 'application/json': { schema: TemplateDetailResponseSchema } },
            description: 'Template detail with blocks and variables',
        },
        404: {
            content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ message: z.string(), code: z.string() }) }) } },
            description: 'Template not found or not editable',
        },
    },
    operationId: 'getEmailTemplate',
    description: 'Returns full detail for one editable template, including block values merged with any tenant override.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── PUT /email-templates/{trigger} ───────────────────────────────────────
const putRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/email-templates/{trigger}',
    tags: ['admin'],
    summary: 'Save email template override',
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: TriggerParamSchema,
        body: { content: { 'application/json': { schema: SaveEmailTemplateSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema } },
            description: 'Override saved',
        },
        400: {
            content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ message: z.string(), code: z.string() }) }) } },
            description: 'Validation error (required template disabled, unknown block)',
        },
        404: {
            content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ message: z.string(), code: z.string() }) }) } },
            description: 'Template not found or not editable',
        },
    },
    operationId: 'saveEmailTemplate',
    description: 'Saves a tenant override for an editable email template. Required templates cannot be disabled. Only known block keys are accepted.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /email-templates/{trigger}/reset ────────────────────────────────
const resetRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/email-templates/{trigger}/reset',
    tags: ['admin'],
    summary: 'Reset email template to defaults',
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: TriggerParamSchema,
    },
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema } },
            description: 'Override removed; template reverts to registry defaults',
        },
        404: {
            content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ message: z.string(), code: z.string() }) }) } },
            description: 'Template not found or not editable',
        },
    },
    operationId: 'resetEmailTemplate',
    description: 'Removes the tenant override for a template, reverting it to registry defaults.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /email-templates/{trigger}/preview ──────────────────────────────
const previewRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/email-templates/{trigger}/preview',
    tags: ['admin'],
    summary: 'Preview email template with unsaved edits',
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: TriggerParamSchema,
        body: { content: { 'application/json': { schema: PreviewEmailTemplateSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: PreviewResponseSchema } },
            description: 'Rendered subject and HTML for the preview',
        },
        404: {
            content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ message: z.string(), code: z.string() }) }) } },
            description: 'Template not found',
        },
    },
    operationId: 'previewEmailTemplate',
    description: 'Renders a template with unsaved edits against sample data, returning the subject and full HTML for preview. Does not persist anything.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── Router ────────────────────────────────────────────────────────────────

export const emailTemplateRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const svc = new EmailTemplateService(c.env.DB);
        const overrides = await svc.listForTenant(tenantId);
        const overrideMap = new Map(overrides.map(o => [o.trigger, o]));

        const editableDescriptors = REGISTRY.filter(d => d.editable);
        const data = editableDescriptors.map(d => {
            const override = overrideMap.get(d.trigger);
            return {
                trigger: d.trigger,
                name: d.name,
                category: d.category,
                required: d.required,
                enabled: override?.enabled ?? true,
                isCustomized: !!override,
                subject: override?.subject ?? d.defaultSubject,
            };
        });

        return c.json({ success: true as const, data }, 200);
    })
    .openapi(getRoute, async (c) => {
        const { trigger } = c.req.valid('param');
        const d = getDescriptor(trigger);
        if (!d || !d.editable) {
            return c.json({ success: false as const, error: { message: 'Template not found', code: 'NOT_FOUND' } }, 404);
        }

        const tenantId = c.get('tenantId');
        const svc = new EmailTemplateService(c.env.DB);
        const overrides = await svc.listForTenant(tenantId);
        const override = overrides.find(o => o.trigger === trigger);

        return c.json({
            success: true as const,
            data: {
                trigger: d.trigger,
                name: d.name,
                required: d.required,
                enabled: override?.enabled ?? true,
                subject: override?.subject ?? d.defaultSubject,
                blocks: d.blocks.map(b => ({
                    key: b.key,
                    label: b.label,
                    multiline: b.multiline,
                    value: override?.blocks?.[b.key] ?? b.default,
                })),
                variables: d.variables,
            },
        }, 200);
    })
    .openapi(putRoute, async (c) => {
        const { trigger } = c.req.valid('param');
        const body = c.req.valid('json');

        const d = getDescriptor(trigger);
        if (!d || !d.editable) {
            return c.json({ success: false as const, error: { message: 'Template not found', code: 'NOT_FOUND' } }, 404);
        }

        if (d.required && body.enabled === false) {
            return c.json({ success: false as const, error: { message: 'This template is required and cannot be disabled.', code: 'VALIDATION_ERROR' } }, 400);
        }

        if (body.blocks) {
            for (const key of Object.keys(body.blocks)) {
                if (!d.blocks.some(b => b.key === key)) {
                    return c.json({ success: false as const, error: { message: `Unknown block: ${key}`, code: 'VALIDATION_ERROR' } }, 400);
                }
            }
        }

        const tenantId = c.get('tenantId');
        await new EmailTemplateService(c.env.DB).upsert(
            tenantId,
            trigger,
            { subject: body.subject, blocks: body.blocks, enabled: body.enabled },
            Date.now(),
        );

        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(resetRoute, async (c) => {
        const { trigger } = c.req.valid('param');
        const d = getDescriptor(trigger);
        if (!d || !d.editable) {
            return c.json({ success: false as const, error: { message: 'Template not found', code: 'NOT_FOUND' } }, 404);
        }

        const tenantId = c.get('tenantId');
        await new EmailTemplateService(c.env.DB).remove(tenantId, trigger);

        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(previewRoute, async (c) => {
        const { trigger } = c.req.valid('param');
        const body = c.req.valid('json');

        const d = getDescriptor(trigger);
        if (!d || !d.editable) {
            return c.json({ success: false as const, error: { message: 'Template not found', code: 'NOT_FOUND' } }, 404);
        }

        const tenantId = c.get('tenantId');
        const brandingService = new BrandingService(c.env.DB, c.env.TENANT_CACHE);
        const emailBrand = await brandingService.getEmailBrand(tenantId);

        const APP_NAME = c.env.APP_NAME;
        const PRIMARY_COLOR = c.env.PRIMARY_COLOR;

        const tenantBrand = {
            name: emailBrand.siteName || APP_NAME || 'OpenInspection',
            logoUrl: emailBrand.logoUrl,
            primaryColor: emailBrand.primaryColor || PRIMARY_COLOR || '#4f46e5',
        };
        const platformBrand = {
            name: APP_NAME || 'OpenInspection',
            logoUrl: null,
            primaryColor: PRIMARY_COLOR || '#4f46e5',
        };

        const override = {
            trigger,
            subject: body.subject ?? null,
            blocks: body.blocks ?? null,
            enabled: true,
        };

        const renderer = new EmailTemplateRenderer({
            tenantBrand,
            platformBrand,
            overrides: new Map([[trigger, override]]),
        });

        const { subject, html } = renderer.render(trigger, sampleDataFor(d));

        return c.json({ success: true as const, data: { subject, html } }, 200);
    });

export type EmailTemplatesApi = typeof emailTemplateRoutes;

export default emailTemplateRoutes;
