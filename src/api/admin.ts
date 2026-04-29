import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { safeISODate } from '../lib/date';
import { getBaseUrl } from '../lib/url';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
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
} from '../lib/validations/admin.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';
import { templates, agreements as agreementTable, inspections, inspectionResults, comments, tenantConfigs } from '../lib/db/schema';

const adminRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/admin/export
 */
const exportDataRoute = createRoute({
    method: 'get',
    path: '/export',
    tags: ['Admin'],
    summary: 'Export tenant data',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AdminExportResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
const inviteMemberRoute = createRoute({
    method: 'post',
    path: '/invite',
    tags: ['Admin'],
    summary: 'Invite team member',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: InviteMemberSchema,
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: InviteResponseSchema,
                },
            },
            description: 'Created',
        },
    },
});

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
const importDataRoute = createRoute({
    method: 'post',
    path: '/import',
    tags: ['Admin'],
    summary: 'Import tenant data',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        inspections: z.array(z.record(z.string(), z.unknown())).optional(),
                        templates: z.array(z.record(z.string(), z.unknown())).optional(),
                        agreements: z.array(z.record(z.string(), z.unknown())).optional(),
                        inspectionResults: z.array(z.record(z.string(), z.unknown())).optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: ImportResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
const listMembersRoute = createRoute({
    method: 'get',
    path: '/members',
    tags: ['Admin'],
    summary: 'List workspace members',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: MemberListResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
const listAgreementsRoute = createRoute({
    method: 'get',
    path: '/agreements',
    tags: ['Admin'],
    summary: 'List agreements',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AgreementListResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

adminRoutes.openapi(listAgreementsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const agreementService = c.var.services.agreement;
    return c.json({ success: true, data: { agreements: await agreementService.listAgreements(tenantId) } }, 200);
});

const createAgreementRoute = createRoute({
    method: 'post',
    path: '/agreements',
    tags: ['Admin'],
    summary: 'Create agreement',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: AgreementSchema,
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: AgreementResponseSchema,
                },
            },
            description: 'Created',
        },
    },
});

adminRoutes.openapi(createAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const agreementService = c.var.services.agreement;
    const agreement = await agreementService.createAgreement(tenantId, body.name, body.content);
    return c.json({ success: true, data: { agreement: agreement } }, 201);
});

const updateAgreementRoute = createRoute({
    method: 'put',
    path: '/agreements/{id}',
    tags: ['Admin'],
    summary: 'Update agreement',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
            content: {
                'application/json': {
                    schema: AgreementSchema.partial(),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AgreementResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

adminRoutes.openapi(updateAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const agreementService = c.var.services.agreement;
    const agreement = await agreementService.updateAgreement(id, tenantId, body.name, body.content);
    return c.json({ success: true, data: { agreement: agreement } }, 200);
});

const deleteAgreementRoute = createRoute({
    method: 'delete',
    path: '/agreements/{id}',
    tags: ['Admin'],
    summary: 'Delete agreement',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

adminRoutes.openapi(deleteAgreementRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const agreementService = c.var.services.agreement;
    await agreementService.deleteAgreement(id, tenantId);
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * GET /api/admin/audit-logs
 */
const getAuditLogsRoute = createRoute({
    method: 'get',
    path: '/audit-logs',
    tags: ['Admin'],
    summary: 'Retrieve audit logs',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        query: z.object({
            limit: z.string().optional(),
            cursor: z.string().optional(),
            action: z.string().optional(),
            entityType: z.string().optional(),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AuditLogResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
 * DELETE /api/admin/data
 */
const eraseDataRoute = createRoute({
    method: 'delete',
    path: '/data',
    tags: ['Admin'],
    summary: 'Erase client data',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: DataErasureSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: EraseDataResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
const getBrandingRoute = createRoute({
    method: 'get',
    path: '/branding',
    tags: ['Branding'],
    summary: 'Retrieve branding configuration',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: BrandingResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
const updateBrandingRoute = createRoute({
    method: 'post',
    path: '/branding',
    tags: ['Branding'],
    summary: 'Update branding configuration',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: UpdateBrandingSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: BrandingResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

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
const uploadLogoRoute = createRoute({
    method: 'post',
    path: '/branding/logo',
    tags: ['Branding'],
    summary: 'Upload branding logo',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        logo: z.any().openapi({ type: 'string', format: 'binary' }),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), logoUrl: z.string() }),
                },
            },
            description: 'Success',
        },
    },
});

adminRoutes.openapi(uploadLogoRoute, async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('logo') as File;
    if (!file || !(file instanceof File)) throw Errors.BadRequest('No logo file provided.');

    const brandingService = c.var.services.branding;
    const logoUrl = await brandingService.uploadLogo(c.get('tenantId'), file);
    return c.json({ success: true, logoUrl }, 200);
});

// ─── Integration Config & Secrets ────────────────────────────────────────────

const IntegrationConfigSchema = z.object({
    appBaseUrl: z.string().optional(),
    turnstileSiteKey: z.string().optional(),
    googleClientId: z.string().optional(),
}).openapi('IntegrationConfig');

const SecretsInputSchema = z.object({
    resendApiKey: z.string().optional(),
    senderEmail: z.string().optional(),
    turnstileSecretKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    googleClientSecret: z.string().optional(),
}).openapi('SecretsInput');

const getConfigRoute = createRoute({
    method: 'get',
    path: '/config',
    tags: ['Config'],
    summary: 'Get integration config and masked secrets',
    middleware: [requireRole(['owner'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ integrationConfig: IntegrationConfigSchema, secrets: z.record(z.string(), z.string()) }) }).openapi('ConfigResponse') } },
            description: 'Success',
        },
    },
});

adminRoutes.openapi(getConfigRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const svc = c.var.services.branding;
    const [integrationConfig, secrets] = await Promise.all([
        svc.getIntegrationConfig(tenantId),
        svc.getMaskedSecrets(tenantId, c.env.JWT_SECRET),
    ]);
    return c.json({ success: true, data: { integrationConfig, secrets } }, 200);
});

const updateIntegrationConfigRoute = createRoute({
    method: 'post',
    path: '/config',
    tags: ['Config'],
    summary: 'Save non-sensitive integration config (plaintext)',
    middleware: [requireRole(['owner'])],
    request: { body: { content: { 'application/json': { schema: IntegrationConfigSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Saved' },
    },
});

adminRoutes.openapi(updateIntegrationConfigRoute, async (c) => {
    const body = c.req.valid('json');
    await c.var.services.branding.updateIntegrationConfig(c.get('tenantId'), body as unknown as import('../services/branding.service').IntegrationConfig);
    auditFromContext(c, 'config.integration.update', 'tenant_config');
    return c.json({ success: true }, 200);
});

const updateSecretsRoute = createRoute({
    method: 'post',
    path: '/config/secrets',
    tags: ['Config'],
    summary: 'Save encrypted secrets (AES-256-GCM). Masked values are ignored.',
    middleware: [requireRole(['owner'])],
    request: { body: { content: { 'application/json': { schema: SecretsInputSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Saved' },
    },
});

adminRoutes.openapi(updateSecretsRoute, async (c) => {
    const body = c.req.valid('json');
    await c.var.services.branding.updateSecrets(c.get('tenantId'), c.env.JWT_SECRET, body as unknown as import('../services/branding.service').SecretsConfig);
    auditFromContext(c, 'config.secrets.update', 'tenant_config');
    return c.json({ success: true }, 200);
});

// --- Agreement Signing ---

const sendAgreementRoute = createRoute({
    method: 'post',
    path: '/agreements/send',
    tags: ['Agreements'],
    summary: 'Send an agreement signing request to a client',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: SendAgreementSchema } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ token: z.string(), signUrl: z.string() }) }) } },
            description: 'Signing request created and email sent',
        },
    },
});

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
    const signUrl = `${getBaseUrl(c)}/agreements/sign/${request.token}`;

    await c.var.services.email.sendAgreementRequest(body.clientEmail, body.clientName ?? null, request.agreementName, signUrl)
        .catch(e => logger.error('Failed to send agreement email', {}, e instanceof Error ? e : undefined));

    auditFromContext(c, 'agreement.send', 'agreement_request', { metadata: { agreementId: body.agreementId, clientEmail: body.clientEmail } });
    return c.json({ success: true as const, data: { token: request.token, signUrl } }, 200);
});

// --- Comments Library ---

const listCommentsRoute = createRoute({
    method: 'get',
    path: '/comments',
    tags: ['Comments'],
    summary: 'List comment library entries',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ comments: z.array(CommentResponseSchema) }) }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});

adminRoutes.openapi(listCommentsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(comments).where(eq(comments.tenantId, tenantId)).all();
    return c.json({ success: true as const, data: { comments: rows.map(r => ({ ...r, createdAt: safeISODate(r.createdAt) })) } }, 200);
});

const createCommentRoute = createRoute({
    method: 'post',
    path: '/comments',
    tags: ['Comments'],
    summary: 'Create a comment library entry',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CommentSchema } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ comment: CommentResponseSchema }) }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
});

adminRoutes.openapi(createCommentRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { text, category } = c.req.valid('json');
    const db = drizzle(c.env.DB);
    const row = { id: crypto.randomUUID(), tenantId, text, category: category ?? null, createdAt: new Date() };
    await db.insert(comments).values(row);
    return c.json({ success: true as const, data: { comment: { ...row, createdAt: safeISODate(row.createdAt) } } }, 201);
});

const deleteCommentRoute = createRoute({
    method: 'delete',
    path: '/comments/{id}',
    tags: ['Comments'],
    summary: 'Delete a comment library entry',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
            description: 'Deleted',
        },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
});

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

// --- ICS Subscription Token ---

const icsTokenRoute = createRoute({
    method: 'get',
    path: '/ics-token',
    tags: ['Calendar'],
    summary: 'Get the tenant ICS subscription URL (creating a token if missing).',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({ url: z.string() }),
                    }),
                },
            },
            description: 'Subscription URL',
        },
    },
    security: [{ bearerAuth: [] }],
});

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

export default adminRoutes;
