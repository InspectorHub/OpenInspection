import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import {
    UpdateBrandingSchema,
    BrandingResponseSchema,
} from '../../lib/validations/admin.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { Errors } from '../../lib/errors';

/**
 * GET /api/admin/branding
 */
const getBrandingRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/branding',
    tags: ["admin"],
    summary: "List tenant branding for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
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
    middleware: [requireRole(['owner', 'admin'])],
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
    middleware: [requireRole(['owner', 'admin'])],
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
            siteName: c.env.APP_NAME || 'OpenInspection',
            primaryColor: c.env.PRIMARY_COLOR || '#4f46e5',
            supportEmail: c.env.SENDER_EMAIL || 'support@example.com'
        });

        const formattedBranding = {
            ...branding,
            siteName: branding.siteName || c.env.APP_NAME || 'OpenInspection',
            primaryColor: branding.primaryColor || c.env.PRIMARY_COLOR || '#4f46e5',
            supportEmail: branding.supportEmail || c.env.SENDER_EMAIL || 'support@example.com',
            logoUrl: branding.logoUrl || null,
            billingUrl: branding.billingUrl || null,
            gaMeasurementId: branding.gaMeasurementId || null
        };

        return c.json({ success: true, data: { branding: formattedBranding } }, 200);
    })
    .openapi(updateBrandingRoute, async (c) => {
        const body = c.req.valid('json');
        const brandingService = c.var.services.branding;
        const result = await brandingService.updateBranding(c.get('tenantId'), body);

        const formattedResult = {
            ...result,
            siteName: result.siteName || c.env.APP_NAME || 'OpenInspection',
            primaryColor: result.primaryColor || c.env.PRIMARY_COLOR || '#4f46e5',
            supportEmail: result.supportEmail || c.env.SENDER_EMAIL || 'support@example.com',
            logoUrl: result.logoUrl || null,
            billingUrl: result.billingUrl || null,
            gaMeasurementId: result.gaMeasurementId || null
        };

        return c.json({ success: true, data: { branding: formattedResult } }, 200);
    })
    .openapi(uploadLogoRoute, async (c) => {
        const formData = await c.req.formData();
        const file = formData.get('logo') as File;
        if (!file || !(file instanceof File)) throw Errors.BadRequest('No logo file provided.');

        const brandingService = c.var.services.branding;
        const logoUrl = await brandingService.uploadLogo(c.get('tenantId'), file);
        return c.json({ success: true, data: { logoUrl } }, 200);
    });

export type AdminBrandingApi = typeof adminBrandingRoutes;
export default adminBrandingRoutes;
