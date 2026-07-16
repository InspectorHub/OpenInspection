import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import {
    UpdateBrandingSchema,
    BrandingResponseSchema,
} from '../../lib/validations/admin.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { Errors } from '../../lib/errors';
import { needsCurrencyChangeConfirm } from '../../lib/currency-guard';

/**
 * GET /api/admin/branding
 */
const getBrandingRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/branding',
    tags: ["admin"],
    summary: "List tenant branding for current tenant",
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: BrandingResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantBranding",
    description: "Auto-generated placeholder for listTenantBranding (GET /branding, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * POST /api/admin/branding
 */
const updateBrandingRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/branding',
    tags: ["admin"],
    summary: "Create tenant branding for current tenant",
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: UpdateBrandingSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: BrandingResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
        409: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.object({
                            code: z.literal('CURRENCY_CHANGE_NEEDS_CONFIRM'),
                            message: z.string(),
                            invoiceCount: z.number(),
                        }),
                    }),
                },
            },
            description: 'Currency change requires explicit confirmation because invoices already exist (Phase B).',
        },
    },
    operationId: "createTenantBranding",
    description: "Auto-generated placeholder for createTenantBranding (POST /branding, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * POST /api/admin/branding/logo
 */
const uploadLogoRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/branding/logo',
    tags: ["admin"],
    summary: "Create tenant branding logo",
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        logo: z.any().openapi({ type: 'string', format: 'binary' }).describe('TODO describe logo field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ logoUrl: z.string().describe('TODO describe logoUrl field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "createTenantBrandingLogo",
    description: "Auto-generated placeholder for createTenantBrandingLogo (POST /branding/logo, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


export const adminBrandingRoutes = createApiRouter()
    .openapi(getBrandingRoute, async (c) => {
        const brandingService = c.var.services.branding;
        const branding = await brandingService.getBranding(c.get('tenantId'), {
            companyName: c.env.APP_NAME || 'OpenInspection',
            primaryColor: c.env.PRIMARY_COLOR || '#4f46e5',
            supportEmail: c.env.SENDER_EMAIL || 'support@example.com'
        });

        const formattedBranding = {
            ...branding,
            companyName: branding.companyName || c.env.APP_NAME || 'OpenInspection',
            primaryColor: branding.primaryColor || c.env.PRIMARY_COLOR || '#4f46e5',
            supportEmail: branding.supportEmail || c.env.SENDER_EMAIL || 'support@example.com',
            logoUrl: branding.logoUrl || null,
            billingUrl: branding.billingUrl || null,
            defaultTimezone: branding.defaultTimezone || 'UTC',
            defaultLocale: branding.defaultLocale || 'en-US',
            currency: branding.currency || 'USD'
        };

        return c.json({ success: true, data: { branding: formattedBranding } }, 200);
    })
    .openapi(updateBrandingRoute, async (c) => {
        const body = c.req.valid('json');
        const brandingService = c.var.services.branding;
        const tenantId = c.get('tenantId');

        // Phase B — `confirmCurrencyChange` is a transient acknowledgement, never a
        // persisted column; strip it before it reaches the branding service.
        const { confirmCurrencyChange, ...brandingData } = body;

        // Guard: block a tenant currency change once invoices exist unless the
        // caller explicitly confirms (the per-invoice snapshot protects history,
        // but the switch itself must be deliberate). Skips the invoice count for
        // no-op / first-ever currency sets so a normal save pays no extra query.
        if (brandingData.currency) {
            const current = await brandingService.getBranding(tenantId, {
                companyName: '', primaryColor: '', supportEmail: '',
            });
            const invoiceCount = current.currency && current.currency !== brandingData.currency
                ? await c.var.services.invoice.countInvoices(tenantId)
                : 0;
            if (needsCurrencyChangeConfirm({
                current: current.currency, next: brandingData.currency, invoiceCount,
                confirmed: confirmCurrencyChange === true,
            })) {
                return c.json({
                    success: false as const,
                    error: {
                        code: 'CURRENCY_CHANGE_NEEDS_CONFIRM' as const,
                        message: `Changing your currency affects ${invoiceCount} existing invoice${invoiceCount === 1 ? '' : 's'}. Existing invoices keep the currency they were billed in; new invoices will use the new currency. Confirm to continue.`,
                        invoiceCount,
                    },
                }, 409);
            }
        }

        const result = await brandingService.updateBranding(tenantId, brandingData);

        const formattedResult = {
            ...result,
            companyName: result.companyName || c.env.APP_NAME || 'OpenInspection',
            primaryColor: result.primaryColor || c.env.PRIMARY_COLOR || '#4f46e5',
            supportEmail: result.supportEmail || c.env.SENDER_EMAIL || 'support@example.com',
            logoUrl: result.logoUrl || null,
            billingUrl: result.billingUrl || null,
            defaultTimezone: result.defaultTimezone || 'UTC',
            defaultLocale: result.defaultLocale || 'en-US',
            currency: result.currency || 'USD'
        };

        return c.json({ success: true, data: { branding: formattedResult } }, 200);
    })
    .openapi(uploadLogoRoute, async (c) => {
        const formData = await c.req.formData();
        const file = formData.get('logo') as File;
        if (!file || !(file instanceof File)) throw Errors.BadRequest('No logo file provided.');

        const MAX_LOGO_BYTES = 2_000_000;
        const ALLOWED = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
        if (file.size > MAX_LOGO_BYTES) throw Errors.BadRequest('logo > 2MB');
        if (!ALLOWED.includes(file.type)) throw Errors.BadRequest('logo must be png, svg, jpeg, or webp');

        const brandingService = c.var.services.branding;
        const logoUrl = await brandingService.uploadLogo(c.get('tenantId'), file);
        return c.json({ success: true, data: { logoUrl } }, 200);
    });

export type AdminBrandingApi = typeof adminBrandingRoutes;
export default adminBrandingRoutes;
