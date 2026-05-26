import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, like, eq as eqDz, asc as ascDz, desc as descDz } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { safeISODate } from '../lib/date';
import { getBaseUrl, getBookingHost } from '../lib/url';
import { escapeLikePattern } from '../lib/db/like-escape';
import { agreementSignUrl } from '../lib/public-urls';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { verifyM2mAuth } from '../lib/m2m-auth';
import {
    UpdateBrandingSchema,
    InviteMemberSchema,
    DataErasureSchema,
    AgreementSchema,
    SendAgreementSchema,
    AdminExportResponseSchema,
    MemberListResponseSchema,
    AuditLogResponseSchema,
    BrandingResponseSchema,
    InviteResponseSchema,
    ImportResponseSchema,
    AgreementListResponseSchema,
    AgreementResponseSchema,
    EraseDataResponseSchema,
    CommentSchema,
    CommentResponseSchema,
    UpdateCommentSchema,
    ListCommentsQuerySchema,
    StripeConnectAccountSchema,
    AttentionThresholdsSchema,
    AttentionThresholdsResponseSchema,
    ATTENTION_THRESHOLDS_DEFAULTS,
    DashboardColumnPrefsSchema,
    DashboardColumnPrefsResponseSchema,
    SeedStarterContentBodySchema,
    SeedStarterContentResponseSchema,
} from '../lib/validations/admin.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';
import { SyncQuotaSchema } from '../lib/validations/sync-quota.schema';
import { templates, agreements as agreementTable, agreements as agreementsTable, agreementRequests as agreementRequestsTable, inspections, inspectionResults, comments, tenantConfigs } from '../lib/db/schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const adminRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/admin/export
 */
const exportDataRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/export',
    tags: ["admin"],
    summary: "Export tenant for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AdminExportResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "exportTenant",
    description: "Auto-generated placeholder for exportTenant (GET /export, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(exportDataRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const adminService = c.var.services.admin;
    const data = await adminService.getExport(tenantId);
    
    auditFromContext(c, 'data.export', 'bulk_export');

    return c.json({ success: true, data: { exportedAt: new Date().toISOString(), tenantId, ...data } }, 200);
});

/**
 * POST /api/admin/invite
 */
const inviteMemberRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/invite',
    tags: ["admin"],
    summary: "Invite tenant for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: InviteMemberSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: InviteResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Created',
        },
    },
    operationId: "inviteTenant",
    description: "Auto-generated placeholder for inviteTenant (POST /invite, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(inviteMemberRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    
    const adminService = c.var.services.admin;
    const { inviteId, expiresAt } = await adminService.createInvite(tenantId, body.email, body.role);

    const inviteLink = `${getBaseUrl(c)}/join?token=${inviteId}`;

    const emailPromise = c.var.services.email.sendInvitation(body.email, inviteLink)
        .catch(() => { /* email delivery is best-effort */ });
    c.executionCtx.waitUntil(emailPromise);

    return c.json({ success: true, data: { inviteLink, expiresAt: expiresAt.toISOString() } }, 201);
});

/**
 * POST /api/admin/import
 */
const importDataRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/import',
    tags: ["admin"],
    summary: "Import tenant for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        inspections: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe inspections field for the OpenInspection MCP integration'),
                        templates: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe templates field for the OpenInspection MCP integration'),
                        agreements: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe agreements field for the OpenInspection MCP integration'),
                        inspectionResults: z.array(z.record(z.string(), z.unknown())).optional().describe('TODO describe inspectionResults field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: ImportResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "importTenant",
    description: "Auto-generated placeholder for importTenant (POST /import, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(importDataRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');

    const importedInspections = Array.isArray(body.inspections) ? body.inspections : [];
    const importedTemplates = Array.isArray(body.templates) ? body.templates : [];
    const importedAgreements = Array.isArray(body.agreements) ? body.agreements : [];
    const importedResults = Array.isArray(body.inspectionResults) ? body.inspectionResults : [];

    const total = importedInspections.length + importedTemplates.length + 
                  importedAgreements.length + importedResults.length;
    if (total === 0) throw Errors.BadRequest('No importable records found.');
    if (total > 5000) throw Errors.BadRequest('Payload too large.');

    const db = drizzle(c.env.DB);
    const counts = { templates: 0, agreements: 0, inspections: 0, results: 0 };

    interface TemplateImport { id: string; name: string; version?: number; schema: unknown; createdAt?: string }
    interface AgreementImport { id: string; name: string; content: string; version?: number; createdAt?: string }
    interface InspectionImport { 
        id: string; propertyAddress: string; inspectorId?: string; clientName?: string; 
        clientEmail?: string; templateId?: string; date?: string; status?: string; 
        paymentStatus?: string; price?: number; createdAt?: string 
    }
    interface ResultImport { id: string; inspectionId: string; data: unknown; lastSyncedAt?: string }

    for (const t of importedTemplates as unknown as TemplateImport[]) {
        if (!t.id || !t.name) continue;
        await db.insert(templates).values({
            id: t.id, tenantId, name: t.name, version: t.version ?? 1,
            schema: typeof t.schema === 'string' ? t.schema : JSON.stringify(t.schema),
            createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
        }).onConflictDoNothing().run();
        counts.templates++;
    }

    for (const a of importedAgreements as unknown as AgreementImport[]) {
        if (!a.id || !a.name) continue;
        await db.insert(agreementTable).values({
            id: a.id, tenantId, name: a.name, content: a.content || '', version: a.version ?? 1,
            createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
        }).onConflictDoNothing().run();
        counts.agreements++;
    }

    for (const ins of importedInspections as unknown as InspectionImport[]) {
        if (!ins.id || !ins.propertyAddress) continue;
        await db.insert(inspections).values({
            id: ins.id, tenantId, propertyAddress: ins.propertyAddress,
            inspectorId: ins.inspectorId || null, clientName: ins.clientName || null,
            clientEmail: ins.clientEmail || null, templateId: ins.templateId || null,
            date: ins.date || new Date().toISOString(), status: ins.status || 'draft',
            paymentStatus: ins.paymentStatus || 'unpaid', price: ins.price || 0,
            createdAt: ins.createdAt ? new Date(ins.createdAt) : new Date(),
        }).onConflictDoNothing().run();
        counts.inspections++;
    }

    for (const r of importedResults as unknown as ResultImport[]) {
        if (!r.id || !r.inspectionId) continue;
        
        // Verify inspectionId belongs to current tenant
        const inspection = await db.select().from(inspections)
            .where(eq(inspections.id, r.inspectionId))
            .get();
        
        if (!inspection) {
            logger.warn(`Skipping result ${r.id}: inspection ${r.inspectionId} not found`);
            continue;
        }
        
        if (inspection.tenantId !== tenantId) {
            logger.warn(`Skipping result ${r.id}: inspection ${r.inspectionId} belongs to different tenant`);
            continue;
        }
        
        await db.insert(inspectionResults).values({
            id: r.id,
            tenantId,
            inspectionId: r.inspectionId,
            data: typeof r.data === 'string' ? r.data : JSON.stringify(r.data),
            lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt) : new Date(),
        }).onConflictDoNothing().run();
        counts.results++;
    }

    auditFromContext(c, 'data.import', 'import', { metadata: { counts } });

    return c.json({ success: true, data: { message: 'Import complete.', imported: counts } }, 200);
});

/**
 * GET /api/admin/members
 */
const listMembersRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/members',
    tags: ["admin"],
    summary: "List tenant members for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: MemberListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantMembers",
    description: "Auto-generated placeholder for listTenantMembers (GET /members, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(listMembersRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const adminService = c.var.services.admin;
    const members = await adminService.getMembers(tenantId);
    
    // Map Date to string for schema compatibility
    const formattedMembers = members.members.map((m: { id: string; email: string; role: string; createdAt: Date }) => ({
        ...m,
        createdAt: safeISODate(m.createdAt)
    }));
    
    return c.json({ success: true, data: formattedMembers }, 200);
});

/**
 * GET Agreements
 */
const listAgreementsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements',
    tags: ["admin"],
    summary: "List tenant agreements for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AgreementListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantAgreements",
    description: "Auto-generated placeholder for listTenantAgreements (GET /agreements, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(listAgreementsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const agreementService = c.var.services.agreement;
    return c.json({ success: true, data: await agreementService.listAgreements(tenantId) }, 200);
});

const createAgreementRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements',
    tags: ["admin"],
    summary: "Create tenant agreements for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: AgreementSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: AgreementResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Created',
        },
    },
    operationId: "createTenantAgreements",
    description: "Auto-generated placeholder for createTenantAgreements (POST /agreements, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(createAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const agreementService = c.var.services.agreement;
    const agreement = await agreementService.createAgreement(tenantId, body.name, body.content);
    return c.json({ success: true, data: { agreement: agreement } }, 201);
});

const updateAgreementRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/agreements/{id}',
    tags: ["admin"],
    summary: "Update tenant agreement for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: AgreementSchema.partial().describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AgreementResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "updateTenantAgreement",
    description: "Auto-generated placeholder for updateTenantAgreement (PUT /agreements/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(updateAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const agreementService = c.var.services.agreement;
    const agreement = await agreementService.updateAgreement(id, tenantId, body.name, body.content);
    return c.json({ success: true, data: { agreement: agreement } }, 200);
});

const deleteAgreementRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/agreements/{id}',
    tags: ["admin"],
    summary: "Delete tenant agreement for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "deleteTenantAgreement",
    description: "Auto-generated placeholder for deleteTenantAgreement (DELETE /agreements/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(deleteAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const agreementService = c.var.services.agreement;
    await agreementService.deleteAgreement(id, tenantId);
    return c.json({ success: true }, 200);
});

/**
 * GET /api/admin/audit-logs
 */
const getAuditLogsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/audit-logs',
    tags: ["admin"],
    summary: "List tenant audit logs",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        query: z.object({
            limit: z.string().optional().describe('TODO describe limit field for the OpenInspection MCP integration'),
            cursor: z.string().optional().describe('TODO describe cursor field for the OpenInspection MCP integration'),
            action: z.string().optional().describe('TODO describe action field for the OpenInspection MCP integration'),
            entityType: z.string().optional().describe('TODO describe entityType field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AuditLogResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTenantAuditLogs",
    description: "Auto-generated placeholder for listTenantAuditLogs (GET /audit-logs, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(getAuditLogsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { limit, cursor, action, entityType } = c.req.valid('query');
    const adminService = c.var.services.admin;
    const result = await adminService.getAuditLogs(tenantId, {
        limit: parseInt(limit || '50'),
        cursor,
        action,
        entityType
    } as Parameters<typeof adminService.getAuditLogs>[1]);

    // Map Date to string for schema compatibility
    const formattedResult = {
        ...result,
        items: result.logs.map(log => ({
            ...log,
            createdAt: safeISODate(log.createdAt)
        }))
    };

    auditFromContext(c, 'audit.view', 'audit_log');

    return c.json({ success: true, data: formattedResult }, 200);
});

/**
 * POST /api/admin/audit-logs
 *
 * Sprint 1 Sub-spec A Task 12 (A-11): client-callable endpoint so the
 * conflict-modal can record \`inspection.sync_conflict_resolved\` audit
 * entries. The action enum is constrained to the small set inspectors
 * can legitimately log; all other audit actions are server-side only.
 */
const InspectorAuditActionSchema = z.enum(['inspection.sync_conflict_resolved']);

const postAuditLogRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/audit-logs',
    tags: ["admin"],
    summary: 'Record an inspector-driven audit event',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        action:       InspectorAuditActionSchema.describe('TODO describe action field for the OpenInspection MCP integration'),
                        resourceType: z.string().min(1).max(64).describe('TODO describe resourceType field for the OpenInspection MCP integration'),
                        resourceId:   z.string().min(1).max(128).describe('TODO describe resourceId field for the OpenInspection MCP integration'),
                        detail:       z.record(z.string(), z.unknown()).optional().describe('TODO describe detail field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Recorded',
        },
    },
    operationId: "createTenantAuditLogs",
    description: "Auto-generated placeholder for createTenantAuditLogs (POST /audit-logs, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(postAuditLogRoute, async (c) => {
    const { action, resourceType, resourceId, detail } = c.req.valid('json');
    auditFromContext(c, action, resourceType, {
        entityId: resourceId,
        ...(detail ? { metadata: detail } : {}),
    });
    return c.json({ success: true }, 200);
});

/**
 * DELETE /api/admin/data
 */
const eraseDataRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/data',
    tags: ["admin"],
    summary: "Delete tenant data for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: DataErasureSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: EraseDataResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "deleteTenantData",
    description: "Auto-generated placeholder for deleteTenantData (DELETE /data, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(eraseDataRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const adminService = c.var.services.admin;
    const counts = await adminService.eraseClientData(tenantId, body.clientEmail);
    
    auditFromContext(c, 'data.delete', 'client', {
        metadata: { clientEmail: body.clientEmail, ...counts },
    });

    return c.json({ success: true, data: { message: 'Client data erased successfully.', ...counts } }, 200);
});

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

adminRoutes.openapi(getBrandingRoute, async (c) => {
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
});

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

adminRoutes.openapi(updateBrandingRoute, async (c) => {
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
});

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
                    schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), logoUrl: z.string().describe('TODO describe logoUrl field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "createTenantBrandingLogo",
    description: "Auto-generated placeholder for createTenantBrandingLogo (POST /branding/logo, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(uploadLogoRoute, async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('logo') as File;
    if (!file || !(file instanceof File)) throw Errors.BadRequest('No logo file provided.');

    const brandingService = c.var.services.branding;
    const logoUrl = await brandingService.uploadLogo(c.get('tenantId'), file);
    return c.json({ success: true, data: { logoUrl } }, 200);
});

// ─── Integration Config & Secrets ────────────────────────────────────────────

const IntegrationConfigSchema = z.object({
    appBaseUrl: z.string().optional().describe('TODO describe appBaseUrl field for the OpenInspection MCP integration'),
    turnstileSiteKey: z.string().optional().describe('TODO describe turnstileSiteKey field for the OpenInspection MCP integration'),
    googleClientId: z.string().optional().describe('TODO describe googleClientId field for the OpenInspection MCP integration'),
}).openapi('IntegrationConfig');

const SecretsInputSchema = z.object({
    resendApiKey: z.string().optional().describe('TODO describe resendApiKey field for the OpenInspection MCP integration'),
    senderEmail: z.string().optional().describe('TODO describe senderEmail field for the OpenInspection MCP integration'),
    turnstileSecretKey: z.string().optional().describe('TODO describe turnstileSecretKey field for the OpenInspection MCP integration'),
    geminiApiKey: z.string().optional().describe('TODO describe geminiApiKey field for the OpenInspection MCP integration'),
    googleClientSecret: z.string().optional().describe('TODO describe googleClientSecret field for the OpenInspection MCP integration'),
}).openapi('SecretsInput');

const getConfigRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/config',
    tags: ["admin"],
    summary: 'Get integration config and masked secrets',
    middleware: [requireRole(['owner'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ integrationConfig: IntegrationConfigSchema.describe('TODO describe integrationConfig field for the OpenInspection MCP integration'), secrets: z.record(z.string(), z.string()).describe('TODO describe secrets field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }).openapi('ConfigResponse') } },
            description: 'Success',
        },
    },
    operationId: "listTenantConfig",
    description: "Auto-generated placeholder for listTenantConfig (GET /config, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(getConfigRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const svc = c.var.services.branding;
    const [integrationConfig, secrets] = await Promise.all([
        svc.getIntegrationConfig(tenantId),
        svc.getMaskedSecrets(tenantId, c.env.JWT_SECRET),
    ]);
    return c.json({ success: true, data: { integrationConfig, secrets } }, 200);
});

const updateIntegrationConfigRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/config',
    tags: ["admin"],
    summary: 'Save non-sensitive integration config (plaintext)',
    middleware: [requireRole(['owner'])],
    request: { body: { content: { 'application/json': { schema: IntegrationConfigSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Saved' },
    },
    operationId: "createTenantConfig",
    description: "Auto-generated placeholder for createTenantConfig (POST /config, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(updateIntegrationConfigRoute, async (c) => {
    const body = c.req.valid('json');
    await c.var.services.branding.updateIntegrationConfig(c.get('tenantId'), body as unknown as import('../services/branding.service').IntegrationConfig);
    auditFromContext(c, 'config.integration.update', 'tenant_config');
    return c.json({ success: true }, 200);
});

const updateSecretsRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/config/secrets',
    tags: ["admin"],
    summary: "Create tenant config secrets",
    middleware: [requireRole(['owner'])],
    request: { body: { content: { 'application/json': { schema: SecretsInputSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Saved' },
    },
    operationId: "createTenantConfigSecrets",
    description: "Auto-generated placeholder for createTenantConfigSecrets (POST /config/secrets, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(updateSecretsRoute, async (c) => {
    const body = c.req.valid('json');
    await c.var.services.branding.updateSecrets(c.get('tenantId'), c.env.JWT_SECRET, body as unknown as import('../services/branding.service').SecretsConfig);
    auditFromContext(c, 'config.secrets.update', 'tenant_config');
    return c.json({ success: true }, 200);
});

// --- Agreement Signing ---

const sendAgreementRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements/send',
    tags: ["admin", "agreements"],
    summary: 'Send an agreement signing request to a client',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: SendAgreementSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration'), signUrl: z.string().describe('TODO describe signUrl field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Signing request created and email sent',
        },
    },
    operationId: "sendTenant",
    description: "Auto-generated placeholder for sendTenant (POST /agreements/send, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(sendAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const svc = c.var.services.agreement;

    const request = await svc.createSigningRequest(tenantId, {
        agreementId: body.agreementId,
        clientEmail: body.clientEmail,
        ...(body.clientName !== undefined ? { clientName: body.clientName } : {}),
        ...(body.inspectionId !== undefined ? { inspectionId: body.inspectionId } : {}),
    });
    const tenantSlug = c.get('requestedSubdomain') ?? '';
    const signUrl = agreementSignUrl(getBookingHost(c), tenantSlug, request.token);

    // Spec 5H D-patch — fetch the agreement HTML at send-time to compute its
    // content hash. This is the "what was the client agreed to" anchor for
    // the audit chain — recomputable later to prove the DB version matches.
    let agreementContentHash: string | null = null;
    let agreementName: string | null = null;
    try {
        const agreement = await drizzle(c.env.DB, { schema })
            .select({ name: schema.agreements.name, content: schema.agreements.content })
            .from(schema.agreements)
            .where(eq(schema.agreements.id, body.agreementId))
            .get();
        if (agreement) {
            agreementName = agreement.name;
            const bytes = new TextEncoder().encode(agreement.content || '');
            const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
            const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
            agreementContentHash = `sha256:${hex}`;
        }
    } catch (e) {
        logger.warn('audit.agreement.hash.failed', { agreementId: body.agreementId, error: (e as Error).message });
    }

    // Spec 5H P0.1 — append request.created to the audit chain
    try {
        await c.var.services.auditLog.append(tenantId, request.id, 'request.created', {
            actorId: c.get('user')?.sub ?? null,
            agreementContentHash,
            agreementId: body.agreementId,
            agreementName,
            clientEmail: body.clientEmail,
            clientName: body.clientName ?? null,
            envelopeId: request.id,
            inspectionId: body.inspectionId ?? null,
            tenantId,
            tsMs: Date.now(),
        });
    } catch (e) {
        logger.warn('audit.append.created.failed', { requestId: request.id, error: (e as Error).message });
    }

    // Sprint B-4a — append the sender (current admin/inspector) signature so
    // the client can rebook with this user via the embedded booking link.
    const senderId = c.get('user')?.sub;
    let sigInspector: { name: string | null; email: string | null; phone: string | null; licenseNumber: string | null; slug: string | null } | undefined;
    if (senderId) {
        try {
            const row = await drizzle(c.env.DB).select({
                name:          schema.users.name,
                email:         schema.users.email,
                phone:         schema.users.phone,
                licenseNumber: schema.users.licenseNumber,
                slug:          schema.users.slug,
            }).from(schema.users)
                .where(and(eq(schema.users.id, senderId), eq(schema.users.tenantId, tenantId)))
                .get();
            sigInspector = row ?? undefined;
        } catch (err) {
            logger.warn('agreement.signature.lookup.failed', { senderId, error: (err as Error).message });
        }
    }

    await c.var.services.email.sendAgreementRequest(body.clientEmail, body.clientName ?? null, request.agreementName, signUrl, sigInspector, getBookingHost(c))
        .catch(e => logger.error('Failed to send agreement email', {}, e instanceof Error ? e : undefined));

    // Append request.sent only after email is dispatched (or attempted)
    try {
        await c.var.services.auditLog.append(tenantId, request.id, 'request.sent', {
            envelopeId: request.id,
            recipientEmail: body.clientEmail,
            signUrl,
            tsMs: Date.now(),
        });
    } catch (e) {
        logger.warn('audit.append.sent.failed', { requestId: request.id, error: (e as Error).message });
    }

    auditFromContext(c, 'agreement.send', 'agreement_request', { metadata: { agreementId: body.agreementId, clientEmail: body.clientEmail } });
    return c.json({ success: true as const, data: { token: request.token, signUrl } }, 200);
});

// --- Spec 5H — Signing Requests admin views ---

const listSigningRequestsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests',
    tags: ["admin"],
    summary: 'List signing requests for tenant',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ requests: z.array(z.unknown()).describe('TODO describe requests field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'OK' },
    },
    operationId: "listTenantAgreementsRequests",
    description: "Auto-generated placeholder for listTenantAgreementsRequests (GET /agreements/requests, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(listSigningRequestsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);
    const rows = await db
        .select({
            id: agreementRequestsTable.id,
            agreementId: agreementRequestsTable.agreementId,
            clientName: agreementRequestsTable.clientName,
            clientEmail: agreementRequestsTable.clientEmail,
            inspectionId: agreementRequestsTable.inspectionId,
            status: agreementRequestsTable.status,
            createdAt: agreementRequestsTable.createdAt,
            sentAt: agreementRequestsTable.sentAt,
            viewedAt: agreementRequestsTable.viewedAt,
            signedAt: agreementRequestsTable.signedAt,
            agreementName: agreementsTable.name,
        })
        .from(agreementRequestsTable)
        .leftJoin(agreementsTable, eqDz(agreementRequestsTable.agreementId, agreementsTable.id))
        .where(eqDz(agreementRequestsTable.tenantId, tenantId))
        .orderBy(descDz(agreementRequestsTable.createdAt))
        .limit(200);
    return c.json({ success: true as const, data: rows }, 200);
});

const getSigningRequestDetailRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests/{id}',
    tags: ["admin"],
    summary: 'Get a signing request with full audit trail',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.unknown().describe('TODO describe data field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false).describe('TODO describe success field for the OpenInspection MCP integration'), error: z.unknown().describe('TODO describe error field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Not found' },
    },
    operationId: "getTenantAgreementsRequest",
    description: "Auto-generated placeholder for getTenantAgreementsRequest (GET /agreements/requests/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(getSigningRequestDetailRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.valid('param').id;
    const db = drizzle(c.env.DB, { schema });
    const reqRow = await db
        .select()
        .from(schema.agreementRequests)
        .where(and(eqDz(schema.agreementRequests.id, id), eqDz(schema.agreementRequests.tenantId, tenantId)))
        .get();
    if (!reqRow) throw Errors.NotFound('Signing request not found');
    const agreement = await db
        .select()
        .from(schema.agreements)
        .where(eqDz(schema.agreements.id, reqRow.agreementId))
        .get();
    const auditRows = await db
        .select()
        .from(schema.esignAuditLogs)
        .where(and(eqDz(schema.esignAuditLogs.tenantId, tenantId), eqDz(schema.esignAuditLogs.requestId, id)))
        .orderBy(ascDz(schema.esignAuditLogs.createdAt))
        .all();
    const verify = await c.var.services.auditLog.verifyChain(tenantId, id);
    return c.json({
        success: true as const,
        data: {
            request: reqRow,
            agreement: agreement ? { id: agreement.id, name: agreement.name } : null,
            auditEvents: auditRows.map((r) => {
                let payload: Record<string, unknown> = {};
                try { payload = JSON.parse(r.payloadJson); } catch { /* ignore */ }
                return {
                    id: r.id,
                    event: r.event,
                    createdAt: r.createdAt,
                    payload,
                    hash: r.hash,
                    prevHash: r.prevHash,
                    signature: r.signature,
                    keyFingerprint: r.keyFingerprint,
                };
            }),
            chainValid: verify.valid,
            chainReason: verify.valid ? null : verify.reason,
        },
    }, 200);
});

const downloadAuditTrailRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests/{id}/audit-trail',
    tags: ["admin"],
    summary: 'Download audit trail JSON for legal evidence',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.unknown().describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Audit JSON download' },
    },
    operationId: "listTenantAgreementsRequestsAuditTrail",
    description: "Auto-generated placeholder for listTenantAgreementsRequestsAuditTrail (GET /agreements/requests/{id}/audit-trail, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(downloadAuditTrailRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.valid('param').id;
    const db = drizzle(c.env.DB, { schema });
    const reqRow = await db
        .select()
        .from(schema.agreementRequests)
        .where(and(eqDz(schema.agreementRequests.id, id), eqDz(schema.agreementRequests.tenantId, tenantId)))
        .get();
    if (!reqRow) throw Errors.NotFound('Signing request not found');
    const auditRows = await db
        .select()
        .from(schema.esignAuditLogs)
        .where(and(eqDz(schema.esignAuditLogs.tenantId, tenantId), eqDz(schema.esignAuditLogs.requestId, id)))
        .orderBy(ascDz(schema.esignAuditLogs.createdAt))
        .all();
    const pubKey = await c.var.services.signingKey.getPublicKey(tenantId);
    const payload = {
        envelopeId: id,
        tenantId,
        clientName: reqRow.clientName,
        clientEmail: reqRow.clientEmail,
        status: reqRow.status,
        publicKeyPem: pubKey?.pem ?? null,
        keyFingerprint: pubKey?.fingerprint ?? null,
        algorithm: 'Ed25519',
        events: auditRows.map((r) => ({
            id: r.id,
            event: r.event,
            createdAt: r.createdAt,
            payloadJson: r.payloadJson,
            prevHash: r.prevHash,
            hash: r.hash,
            signature: r.signature,
            keyFingerprint: r.keyFingerprint,
        })),
        exportedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="audit-trail-${id.slice(0, 8)}.json"`,
        },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
});

// --- Comments Library ---

// Spec 2026-05-07 — narrow Drizzle's generic `string | null` for
// `ratingBucket` down to the Zod enum shape the OpenAPI response schema
// declares. The DB column is just TEXT (column constraint isn't enforced
// at the SQLite layer), so we cast at the response boundary.
type RatingBucketResp = 'satisfactory' | 'monitor' | 'defect' | null;
function commentRowToResponse(r: typeof comments.$inferSelect) {
    return {
        ...r,
        ratingBucket: (r.ratingBucket as RatingBucketResp) ?? null,
        createdAt: safeISODate(r.createdAt),
    };
}

const listCommentsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/comments',
    tags: ["admin"],
    summary: 'List comment library entries',
    // Inspectors need read access so the inspection-edit picker (T7+1) can
    // populate. Create/delete remain admin-only further below.
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { query: ListCommentsQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ comments: z.array(CommentResponseSchema).describe('TODO describe comments field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantComments",
    description: "Auto-generated placeholder for listTenantComments (GET /comments, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(listCommentsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { rating, section, sectionId, triggerCode, search } = c.req.valid('query');
    const db = drizzle(c.env.DB);
    // Filters layered defensively: tenantId always first (multi-tenant
    // isolation rule from CLAUDE.md), then optional rating bucket / section
    // / free-text search.
    const conditions = [eq(comments.tenantId, tenantId)];
    if (rating) conditions.push(eq(comments.ratingBucket, rating));
    if (section) conditions.push(eq(comments.section, section));
    if (sectionId) {
        conditions.push(like(comments.sectionIds, `%"${escapeLikePattern(sectionId)}"%`));
    }
    if (triggerCode) {
        conditions.push(eq(comments.triggerCode, triggerCode));
    }
    let rows = await db.select().from(comments).where(and(...conditions)).all();
    if (search && search.trim()) {
        const needle = search.trim().toLowerCase();
        rows = rows.filter(r => r.text.toLowerCase().includes(needle));
    }
    return c.json({ success: true as const, data: rows.map(commentRowToResponse) }, 200);
});

const createCommentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/comments',
    tags: ["admin"],
    summary: 'Create a comment library entry',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CommentSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ comment: CommentResponseSchema.describe('TODO describe comment field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createTenantComments",
    description: "Auto-generated placeholder for createTenantComments (POST /comments, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(createCommentRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { text, category, ratingBucket, section } = c.req.valid('json');
    const db = drizzle(c.env.DB);
    const row = {
        id: crypto.randomUUID(),
        tenantId,
        text,
        category: category ?? null,
        ratingBucket: ratingBucket ?? null,
        section: section ?? null,
        // S2-7 — libraryId tracks marketplace provenance; null for tenant-authored.
        libraryId: null as string | null,
        sectionIds: null as string | null,
        itemLabels: null as string | null,
        triggerCode: null as string | null,
        searchKeywords: null as string | null,
        createdAt: new Date(),
    };
    await db.insert(comments).values(row);
    return c.json({ success: true as const, data: { comment: commentRowToResponse(row) } }, 201);
});

const deleteCommentRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/comments/{id}',
    tags: ["admin"],
    summary: 'Delete a comment library entry',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Deleted',
        },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteTenantComment",
    description: "Auto-generated placeholder for deleteTenantComment (DELETE /comments/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(deleteCommentRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const db = drizzle(c.env.DB);
    const existing = await db.select().from(comments)
        .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Comment not found');
    await db.delete(comments).where(and(eq(comments.id, id), eq(comments.tenantId, tenantId)));
    return c.json({ success: true }, 200);
});

const updateCommentRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/comments/{id}',
    tags: ["admin"],
    summary: 'Update a comment library entry',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateCommentSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ comment: CommentResponseSchema.describe('TODO describe comment field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Updated',
        },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "updateTenantComment",
    description: "Auto-generated placeholder for updateTenantComment (PUT /comments/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(updateCommentRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const { text, category, ratingBucket, section } = c.req.valid('json');
    const db = drizzle(c.env.DB);
    const existing = await db.select().from(comments)
        .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Comment not found');
    const patch = {
        text,
        category: category ?? null,
        ratingBucket: ratingBucket ?? null,
        section: section ?? null,
    };
    await db.update(comments)
        .set(patch)
        .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId)));
    const updated = { ...existing, ...patch };
    auditFromContext(c, 'comment.updated', 'comment', {
        entityId: id,
        metadata: {
            category: category ?? null,
            ratingBucket: ratingBucket ?? null,
            section: section ?? null,
            textPreview: text.slice(0, 80),
        },
    });
    return c.json({ success: true as const, data: { comment: commentRowToResponse(updated) } }, 200);
});

// --- Widget Origin Allowlist ---

const getWidgetOriginsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/widget/origins',
    tags: ["admin"],
    summary: 'Get current widget allowed-origin list',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ origins: z.array(z.string()).describe('TODO describe origins field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantWidgetOrigins",
    description: "Auto-generated placeholder for listTenantWidgetOrigins (GET /widget/origins, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(getWidgetOriginsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const origins = await c.var.services.widget.getAllowedOrigins(tenantId);
    return c.json({ success: true as const, data: { origins } }, 200);
});

const setWidgetOriginsRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/widget/origins',
    tags: ["admin"],
    summary: 'Replace widget allowed-origin list',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: z.object({ origins: z.array(z.string().min(1)).max(50).describe('TODO describe origins field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ origins: z.array(z.string()).describe('TODO describe origins field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Saved',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "updateTenantWidgetOrigin",
    description: "Auto-generated placeholder for updateTenantWidgetOrigin (PUT /widget/origins, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(setWidgetOriginsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { origins } = c.req.valid('json');
    await c.var.services.widget.setAllowedOrigins(tenantId, origins);
    return c.json({ success: true as const, data: { origins } }, 200);
});

// --- Stripe Connect (inspector-facing) ---

const getStripeConnectRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/stripe-connect',
    tags: ["admin"],
    summary: 'Get the tenant Stripe Connect account ID',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ accountId: z.string().nullable().describe('TODO describe accountId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantStripeConnect",
    description: "Auto-generated placeholder for listTenantStripeConnect (GET /stripe-connect, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(getStripeConnectRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { accountId } = await c.var.services.admin.getStripeConnect(tenantId);
    return c.json({ success: true as const, data: { accountId } }, 200);
});

const setStripeConnectRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/stripe-connect',
    tags: ["admin"],
    summary: 'Set the tenant Stripe Connect account ID',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: StripeConnectAccountSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ accountId: z.string().describe('TODO describe accountId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Saved',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "updateTenantStripeConnect",
    description: "Auto-generated placeholder for updateTenantStripeConnect (PUT /stripe-connect, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(setStripeConnectRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { accountId } = c.req.valid('json');
    await c.var.services.admin.setStripeConnect(tenantId, accountId);
    auditFromContext(c, 'config.integration.update', 'tenant_config', { metadata: { stripeConnect: 'set' } });
    return c.json({ success: true as const, data: { accountId } }, 200);
});

const deleteStripeConnectRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/stripe-connect',
    tags: ["admin"],
    summary: 'Disconnect the tenant Stripe Connect account',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ accountId: z.null().describe('TODO describe accountId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Cleared',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteTenantStripeConnect",
    description: "Auto-generated placeholder for deleteTenantStripeConnect (DELETE /stripe-connect, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(deleteStripeConnectRoute, async (c) => {
    const tenantId = c.get('tenantId');
    await c.var.services.admin.setStripeConnect(tenantId, null);
    auditFromContext(c, 'config.integration.update', 'tenant_config', { metadata: { stripeConnect: 'cleared' } });
    return c.json({ success: true as const, data: { accountId: null } }, 200);
});

// --- Earnings Summary ---

const getEarningsSummaryRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/earnings-summary',
    tags: ["admin"],
    summary: 'Get aggregated invoice earnings (paid/pending/count)',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            paid: z.number().describe('TODO describe paid field for the OpenInspection MCP integration'),
                            pending: z.number().describe('TODO describe pending field for the OpenInspection MCP integration'),
                            count: z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
                        }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantEarningsSummary",
    description: "Auto-generated placeholder for listTenantEarningsSummary (GET /earnings-summary, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));
adminRoutes.openapi(getEarningsSummaryRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const summary = await c.var.services.invoice.getEarningsSummary(tenantId);
    return c.json({ success: true as const, data: summary }, 200);
});

// --- ICS Subscription Token ---

const icsTokenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/ics-token',
    tags: ["admin", "calendar"],
    summary: "List tenant ics token",
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({ url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Subscription URL',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantIcsToken",
    description: "Auto-generated placeholder for listTenantIcsToken (GET /ics-token, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(icsTokenRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);

    const configs = await db
        .select()
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .limit(1);

    let token = configs[0]?.icsToken ?? null;

    if (!token) {
        token = crypto.randomUUID().replace(/-/g, '');
        if (configs[0]) {
            await db
                .update(tenantConfigs)
                .set({ icsToken: token, updatedAt: new Date() })
                .where(eq(tenantConfigs.tenantId, tenantId));
        } else {
            await db.insert(tenantConfigs).values({
                tenantId,
                icsToken: token,
                updatedAt: new Date(),
            });
        }
    }

    const baseUrl = getBaseUrl(c);
    return c.json({ success: true as const, data: { url: `${baseUrl}/api/ics/${token}` } }, 200);
});

/**
 * POST /api/admin/backfill-default-templates — Spec 4F polish backfill.
 * One-shot M2M endpoint: loops through every tenant and seeds the 7 default templates
 * (idempotent — TemplateSeedService.bulkSeed skips existing names per tenant).
 *
 * Auth: PORTAL_M2M_SECRET via Authorization: Bearer.
 * Use case: existing tenants that pre-date Spec 4F's auto-seed-on-tenant-init hook.
 */
adminRoutes.openapi(withMcpMetadata({
    method: 'post',
    path: '/backfill-default-templates',
    operationId: 'backfillDefaultTemplates',
    tags: ['sysadmin'],
    summary: 'Backfill default templates across all tenants',
    description: 'M2M one-shot endpoint that seeds the default 7 templates for every tenant. Idempotent — TemplateSeedService.bulkSeed skips templates that already exist by name per tenant.',
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
}, { scopes: [], tier: 'excluded' }), async (c) => {
    if (!verifyM2mAuth(c.req.header('authorization'), c.env as unknown as Record<string, string | undefined>)) {
        throw Errors.Unauthorized();
    }

    const { tenants } = await import('../lib/db/schema');
    const { TemplateSeedService } = await import('../services/template-seed.service');
    const db = drizzle(c.env.DB);
    const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).all();
    const svc = new TemplateSeedService(c.env.DB);

    const results: { tenantId: string; name: string; seeded: number; skipped: number }[] = [];
    for (const t of allTenants) {
        try {
            const r = await svc.bulkSeed(t.id as string);
            results.push({ tenantId: t.id as string, name: (t.name as string) ?? '', ...r });
        } catch (err) {
            logger.error('Backfill failed for tenant', { tenantId: t.id }, err instanceof Error ? err : undefined);
        }
    }
    const totalSeeded = results.reduce((sum, r) => sum + r.seeded, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
    logger.info('Backfill complete', { tenantCount: results.length, totalSeeded, totalSkipped });
    return c.json({ success: true as const }, 200);
});

// --- Attention Thresholds (handoff-decisions §1) ---
//
// Configurable per-team thresholds (in hours) applied to the dashboard
// "Needs Attention" bucket. Stored as JSON on `tenant_configs.attention_thresholds`.

const getAttentionThresholdsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/attention-thresholds',
    tags: ["admin"],
    summary: "List tenant attention thresholds",
    middleware: [requireRole(['owner', 'admin'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: AttentionThresholdsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "listTenantAttentionThresholds",
    description: "Auto-generated placeholder for listTenantAttentionThresholds (GET /attention-thresholds, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(getAttentionThresholdsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);
    const row = await db.select({ thresholds: tenantConfigs.attentionThresholds })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .limit(1);
    const thresholds = row[0]?.thresholds ?? ATTENTION_THRESHOLDS_DEFAULTS;
    return c.json({ success: true as const, data: { thresholds } }, 200);
});

const updateAttentionThresholdsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/attention-thresholds',
    tags: ["admin"],
    summary: "Patch tenant attention threshold",
    middleware: [requireRole(['owner', 'admin'])] as const,
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

adminRoutes.openapi(updateAttentionThresholdsRoute, async (c) => {
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
});

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
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: DashboardColumnPrefsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "listTenantDashboardColumns",
    description: "Auto-generated placeholder for listTenantDashboardColumns (GET /dashboard-columns, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(getDashboardColumnsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const columns = await c.var.services.dashboardPrefs.getColumnPrefs(tenantId);
    return c.json({ success: true as const, data: { columns } }, 200);
});

const updateDashboardColumnsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/dashboard-columns',
    tags: ["admin"],
    summary: 'Update tenant default dashboard column prefs',
    middleware: [requireRole(['owner', 'admin'])] as const,
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

adminRoutes.openapi(updateDashboardColumnsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const columns = await c.var.services.dashboardPrefs.setColumnPrefs(tenantId, body.columns);
    auditFromContext(c, 'config.dashboard_columns.update', 'tenant_config', { metadata: { columns } });
    return c.json({ success: true as const, data: { columns } }, 200);
});

// -----------------------------------------------------------------------------
// GET /api/admin/tenant-config — read booking-related tenant config flags
// -----------------------------------------------------------------------------
const TenantConfigGetResponseSchema = z.object({
    success: z.boolean().describe('Whether the request succeeded'),
    data: z.object({
        conciergeReviewRequired: z.boolean().describe('Whether bookings require concierge review before confirmation'),
        blockUnsignedAgreement: z.boolean().describe('Whether unsigned agreements block inspection start'),
    }).describe('Current tenant configuration flags'),
}).openapi('TenantConfigGetResponse');

const tenantConfigGetRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/tenant-config',
    tags: ["admin"],
    summary: 'Get tenant configuration flags',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: TenantConfigGetResponseSchema.describe('Tenant configuration flags') } },
            description: 'Success',
        },
    },
    operationId: "getTenantConfig",
    description: "Returns booking-related tenant configuration flags (conciergeReviewRequired, blockUnsignedAgreement)."
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(tenantConfigGetRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const config = await c.var.services.branding.getBranding(tenantId);
    return c.json({
        success: true as const,
        data: {
            conciergeReviewRequired: config?.conciergeReviewRequired ?? false,
            blockUnsignedAgreement: config?.blockUnsignedAgreement ?? false,
        },
    }, 200);
});

// -----------------------------------------------------------------------------
// Agent Accounts A3 — concierge review-mode toggle (PATCH /api/admin/tenant-config)
// -----------------------------------------------------------------------------
// Generic patch endpoint scoped to a small allowlist of tenant_configs columns
// the settings UI surfaces directly. Currently only `conciergeReviewRequired`.
// Adding more keys here in the future stays a one-line allowlist change.
const TenantConfigPatchSchema = z.object({
    conciergeReviewRequired: z.boolean().optional().describe('TODO describe conciergeReviewRequired field for the OpenInspection MCP integration'),
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
    middleware: [requireRole(['owner', 'admin'])] as const,
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

adminRoutes.openapi(tenantConfigPatchRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');

    const update: Partial<typeof tenantConfigs.$inferInsert> = {};
    if (body.conciergeReviewRequired !== undefined) {
        update.conciergeReviewRequired = body.conciergeReviewRequired;
    }
    if (Object.keys(update).length === 0) {
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    }
    await c.var.services.branding.updateBranding(tenantId, update);
    auditFromContext(c, 'config.tenant_config.patch', 'tenant_config', {
        metadata: update,
    });
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
});

/**
 * Design System 0520 subsystem C P8 T8.2 — portal → core seat-quota sync.
 *
 * Called by `apps/portal/src/services/billing.service.ts#syncSeatQuota`
 * after a Stripe `customer.subscription.{created,updated,deleted}` event.
 * Updates `tenants.max_users` so the seat-guard middleware + Guest-
 * InviteService.claim see the new cap on the next request.
 *
 * Auth: `Authorization: Bearer <PORTAL_M2M_SECRET>` (or any active V<N>).
 */
adminRoutes.openapi(withMcpMetadata({
    method: 'post',
    path: '/sync-quota',
    operationId: 'syncTenantSeatQuota',
    tags: ['sysadmin'],
    summary: 'Sync tenant seat quota from portal',
    description: 'M2M endpoint called by the portal whenever a tenant\'s subscription seat count changes. Updates the tenant\'s max_users column so InviteService.claim sees the new cap on the next request.',
    request: { body: { content: { 'application/json': { schema: SyncQuotaSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' },
        401: { description: 'Unauthorized' },
        404: { description: 'Tenant not found' },
    },
}, { scopes: [], tier: 'excluded' }), async (c) => {
    if (!verifyM2mAuth(c.req.header('authorization'), c.env as unknown as Record<string, string | undefined>)) {
        throw Errors.Unauthorized();
    }

    const { tenantId, maxUsers } = c.req.valid('json');
    const { tenants } = await import('../lib/db/schema');
    const db = drizzle(c.env.DB);

    const result = await db.update(tenants)
        .set({ maxUsers })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
    if (result.length === 0) throw Errors.NotFound('Tenant not found');

    // Invalidate the per-tenant KV cache so the next request reads the
    // fresh maxUsers value rather than the stale snapshot.
    try {
        await c.env.TENANT_CACHE.delete(`tenant:${tenantId}`);
    } catch { /* cache miss is fine — read-through repopulates */ }

    logger.info('sync-quota applied', { tenantId, maxUsers });
    return c.json({ success: true as const }, 200);
});

/**
 * POST /api/admin/seed-starter-content — Trial Sample-Data Mode spec (2026-05-20).
 *
 * Portal calls this from OnboardingWorkflow step 2.5 once a new tenant is
 * provisioned, populating it with starter content (3 templates / 1 agreement /
 * 250 canned comments / 3 event_types / 4 tags / recommendations /
 * rating-systems / marketplace defaults). Idempotent — safe to retry on
 * workflow re-run.
 *
 * Auth: `Authorization: Bearer <PORTAL_M2M_SECRET>` (or any active V<N>);
 * matches the other portal → core M2M endpoints in this file.
 */
adminRoutes.openapi(withMcpMetadata({
    method: 'post',
    path: '/seed-starter-content',
    operationId: 'seedStarterContentForTenant',
    tags: ['sysadmin'],
    summary: 'Seed starter content into newly-provisioned tenant',
    description: 'M2M endpoint invoked by the portal\'s OnboardingWorkflow once a tenant is provisioned. Seeds initial templates, agreements, rating-systems, and marketplace defaults. Idempotent — safe to retry.',
    request: { body: { content: { 'application/json': { schema: SeedStarterContentBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: SeedStarterContentResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Seed counts (zero on idempotent re-run)',
        },
        401: { description: 'Unauthorized' },
        404: { description: 'Tenant not found' },
    },
}, { scopes: [], tier: 'excluded' }), async (c) => {
    if (!verifyM2mAuth(c.req.header('authorization'), c.env as unknown as Record<string, string | undefined>)) {
        throw Errors.Unauthorized();
    }

    const { tenantId } = c.req.valid('json');
    const { tenants } = await import('../lib/db/schema');
    const db = drizzle(c.env.DB);
    const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).get();
    if (!existing) throw Errors.NotFound('Tenant not found');

    const { seedStarterContent } = await import('../services/starter-content.service');
    const result = await seedStarterContent(c.env.DB, tenantId);

    return c.json({ success: true as const, data: result }, 200);
});

// --- Finding Key Migration (one-time data migration) ---
//
// Batch-converts inspection_results.data keys from the legacy `itemId`
// format to the composite `_default:sectionId:itemId` format. Idempotent —
// keys that already contain 2+ colons are skipped.

const migrateFindingKeysRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/migrate-finding-keys',
    tags: ['admin'],
    summary: 'One-time migration: rewrite legacy finding keys to composite format',
    middleware: [requireRole(['owner'])] as const,
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            processed: z.number(),
                            migrated: z.number(),
                            skipped: z.number(),
                        }),
                    }),
                },
            },
            description: 'Migration complete',
        },
    },
    operationId: 'migrateFindingKeys',
    description: 'Batch-converts inspection_results.data keys from legacy itemId format to composite _default:sectionId:itemId format. Idempotent — already-composite keys are skipped.',
}, { scopes: ['admin'], tier: 'extended' }));

adminRoutes.openapi(migrateFindingKeysRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);

    let processed = 0;
    let migrated = 0;
    let skipped = 0;

    const BATCH_SIZE = 50;
    let offset = 0;

    // Process inspections in batches
    while (true) {
        const batch = await db.select({
            id:                inspections.id,
            templateId:        inspections.templateId,
            templateSnapshot:  inspections.templateSnapshot,
        })
        .from(inspections)
        .where(eq(inspections.tenantId, tenantId))
        .limit(BATCH_SIZE)
        .offset(offset);

        if (batch.length === 0) break;
        offset += batch.length;

        for (const insp of batch) {
            // Load the results row for this inspection
            const resultsRow = await db.select()
                .from(inspectionResults)
                .where(and(
                    eq(inspectionResults.inspectionId, insp.id),
                    eq(inspectionResults.tenantId, tenantId),
                ))
                .get();

            if (!resultsRow || !resultsRow.data) {
                skipped++;
                continue;
            }

            const data: Record<string, unknown> = typeof resultsRow.data === 'string'
                ? JSON.parse(resultsRow.data)
                : resultsRow.data as Record<string, unknown>;

            // Build itemId → sectionId mapping from template snapshot or
            // live template schema
            const itemToSection = new Map<string, string>();

            interface SchemaSectionLite { id: string; items?: Array<{ id: string }> }
            let sections: SchemaSectionLite[] = [];

            const snap = insp.templateSnapshot as { sections?: SchemaSectionLite[] } | null;
            if (snap && Array.isArray(snap?.sections)) {
                sections = snap.sections;
            } else if (insp.templateId) {
                const tpl = await db.select().from(templates)
                    .where(and(eq(templates.id, insp.templateId), eq(templates.tenantId, tenantId)))
                    .get();
                const live = tpl?.schema as { sections?: SchemaSectionLite[] } | null;
                if (live && Array.isArray(live?.sections)) {
                    sections = live.sections;
                }
            }

            for (const sec of sections) {
                for (const item of (sec.items ?? [])) {
                    itemToSection.set(item.id, sec.id);
                }
            }

            // Rewrite legacy keys
            let changed = false;
            const newData: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
                // Already composite (has 2+ colons) — keep as-is
                if (key.split(':').length >= 3) {
                    newData[key] = value;
                    continue;
                }
                const sectionId = itemToSection.get(key) ?? '_unknown';
                const compositeKey = `_default:${sectionId}:${key}`;
                newData[compositeKey] = value;
                changed = true;
            }

            if (changed) {
                await db.update(inspectionResults)
                    .set({ data: newData as unknown as object, lastSyncedAt: new Date() })
                    .where(eq(inspectionResults.id, resultsRow.id));
                migrated++;
            } else {
                skipped++;
            }
            processed++;
        }
    }

    auditFromContext(c, 'admin.migrate_finding_keys', 'inspection_results', {
        metadata: { processed, migrated, skipped },
    });

    return c.json({
        success: true as const,
        data: { processed, migrated, skipped },
    }, 200);
});

export default adminRoutes;
