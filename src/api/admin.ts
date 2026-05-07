import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, eq as eqDz, asc as ascDz, desc as descDz } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
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
    UpdateCommentSchema,
    ListCommentsQuerySchema,
    StripeConnectAccountSchema,
} from '../lib/validations/admin.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';
import { templates, agreements as agreementTable, agreements as agreementsTable, agreementRequests as agreementRequestsTable, inspections, inspectionResults, comments, tenantConfigs } from '../lib/db/schema';

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

    await c.var.services.email.sendAgreementRequest(body.clientEmail, body.clientName ?? null, request.agreementName, signUrl)
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

const listSigningRequestsRoute = createRoute({
    method: 'get',
    path: '/agreements/requests',
    tags: ['Admin'],
    summary: 'List signing requests for tenant',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ requests: z.array(z.unknown()) }) }) } }, description: 'OK' },
    },
});
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
    return c.json({ success: true as const, data: { requests: rows } }, 200);
});

const getSigningRequestDetailRoute = createRoute({
    method: 'get',
    path: '/agreements/requests/{id}',
    tags: ['Admin'],
    summary: 'Get a signing request with full audit trail',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.unknown() }) } }, description: 'OK' },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.unknown() }) } }, description: 'Not found' },
    },
});
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
                try { payload = JSON.parse(r.payloadJson); } catch (_) { /* ignore */ }
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

const downloadAuditTrailRoute = createRoute({
    method: 'get',
    path: '/agreements/requests/{id}/audit-trail',
    tags: ['Admin'],
    summary: 'Download audit trail JSON for legal evidence',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.unknown() } }, description: 'Audit JSON download' },
    },
});
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

const listCommentsRoute = createRoute({
    method: 'get',
    path: '/comments',
    tags: ['Comments'],
    summary: 'List comment library entries',
    // Inspectors need read access so the inspection-edit picker (T7+1) can
    // populate. Create/delete remain admin-only further below.
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { query: ListCommentsQuerySchema },
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
    const { rating, section, search } = c.req.valid('query');
    const db = drizzle(c.env.DB);
    // Filters layered defensively: tenantId always first (multi-tenant
    // isolation rule from CLAUDE.md), then optional rating bucket / section
    // / free-text search.
    const conditions = [eq(comments.tenantId, tenantId)];
    if (rating) conditions.push(eq(comments.ratingBucket, rating));
    if (section) conditions.push(eq(comments.section, section));
    let rows = await db.select().from(comments).where(and(...conditions)).all();
    if (search && search.trim()) {
        const needle = search.trim().toLowerCase();
        rows = rows.filter(r => r.text.toLowerCase().includes(needle));
    }
    return c.json({ success: true as const, data: { comments: rows.map(commentRowToResponse) } }, 200);
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
    const { text, category, ratingBucket, section } = c.req.valid('json');
    const db = drizzle(c.env.DB);
    const row = {
        id: crypto.randomUUID(),
        tenantId,
        text,
        category: category ?? null,
        ratingBucket: ratingBucket ?? null,
        section: section ?? null,
        createdAt: new Date(),
    };
    await db.insert(comments).values(row);
    return c.json({ success: true as const, data: { comment: commentRowToResponse(row) } }, 201);
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

const updateCommentRoute = createRoute({
    method: 'put',
    path: '/comments/{id}',
    tags: ['Comments'],
    summary: 'Update a comment library entry',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { 'application/json': { schema: UpdateCommentSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ comment: CommentResponseSchema }) }) } },
            description: 'Updated',
        },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
});

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

const getWidgetOriginsRoute = createRoute({
    method: 'get',
    path: '/widget/origins',
    tags: ['Widget'],
    summary: 'Get current widget allowed-origin list',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ origins: z.array(z.string()) }) }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});
adminRoutes.openapi(getWidgetOriginsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const origins = await c.var.services.widget.getAllowedOrigins(tenantId);
    return c.json({ success: true as const, data: { origins } }, 200);
});

const setWidgetOriginsRoute = createRoute({
    method: 'put',
    path: '/widget/origins',
    tags: ['Widget'],
    summary: 'Replace widget allowed-origin list',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: z.object({ origins: z.array(z.string().min(1)).max(50) }) } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ origins: z.array(z.string()) }) }) } },
            description: 'Saved',
        },
    },
    security: [{ bearerAuth: [] }],
});
adminRoutes.openapi(setWidgetOriginsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { origins } = c.req.valid('json');
    await c.var.services.widget.setAllowedOrigins(tenantId, origins);
    return c.json({ success: true as const, data: { origins } }, 200);
});

// --- Stripe Connect (inspector-facing) ---

const getStripeConnectRoute = createRoute({
    method: 'get',
    path: '/stripe-connect',
    tags: ['Stripe'],
    summary: 'Get the tenant Stripe Connect account ID',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ accountId: z.string().nullable() }) }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});
adminRoutes.openapi(getStripeConnectRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { accountId } = await c.var.services.admin.getStripeConnect(tenantId);
    return c.json({ success: true as const, data: { accountId } }, 200);
});

const setStripeConnectRoute = createRoute({
    method: 'put',
    path: '/stripe-connect',
    tags: ['Stripe'],
    summary: 'Set the tenant Stripe Connect account ID',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: StripeConnectAccountSchema } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ accountId: z.string() }) }) } },
            description: 'Saved',
        },
    },
    security: [{ bearerAuth: [] }],
});
adminRoutes.openapi(setStripeConnectRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { accountId } = c.req.valid('json');
    await c.var.services.admin.setStripeConnect(tenantId, accountId);
    auditFromContext(c, 'config.integration.update', 'tenant_config', { metadata: { stripeConnect: 'set' } });
    return c.json({ success: true as const, data: { accountId } }, 200);
});

const deleteStripeConnectRoute = createRoute({
    method: 'delete',
    path: '/stripe-connect',
    tags: ['Stripe'],
    summary: 'Disconnect the tenant Stripe Connect account',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ accountId: z.null() }) }) } },
            description: 'Cleared',
        },
    },
    security: [{ bearerAuth: [] }],
});
adminRoutes.openapi(deleteStripeConnectRoute, async (c) => {
    const tenantId = c.get('tenantId');
    await c.var.services.admin.setStripeConnect(tenantId, null);
    auditFromContext(c, 'config.integration.update', 'tenant_config', { metadata: { stripeConnect: 'cleared' } });
    return c.json({ success: true as const, data: { accountId: null } }, 200);
});

// --- Earnings Summary ---

const getEarningsSummaryRoute = createRoute({
    method: 'get',
    path: '/earnings-summary',
    tags: ['Stripe'],
    summary: 'Get aggregated invoice earnings (paid/pending/count)',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            paid: z.number(),
                            pending: z.number(),
                            count: z.number(),
                        }),
                    }),
                },
            },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});
adminRoutes.openapi(getEarningsSummaryRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const summary = await c.var.services.invoice.getEarningsSummary(tenantId);
    return c.json({ success: true as const, data: summary }, 200);
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

/**
 * POST /api/admin/backfill-default-templates — Spec 4F polish backfill.
 * One-shot M2M endpoint: loops through every tenant and seeds the 7 default templates
 * (idempotent — TemplateSeedService.bulkSeed skips existing names per tenant).
 *
 * Auth: PORTAL_M2M_SECRET via Authorization: Bearer.
 * Use case: existing tenants that pre-date Spec 4F's auto-seed-on-tenant-init hook.
 */
adminRoutes.openapi({
    method: 'post',
    path: '/backfill-default-templates',
    tags: ['Admin'],
    summary: 'Backfill default 7 templates for every tenant (one-shot, idempotent)',
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
}, async (c) => {
    const auth = c.req.header('authorization');
    if (auth !== `Bearer ${c.env.PORTAL_M2M_SECRET}`) throw Errors.Unauthorized();

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
    return c.json({ success: true as const, data: { success: true } }, 200);
});

export default adminRoutes;
