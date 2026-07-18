// Admin → Agreements sub-router (Phase 1.3 split of server/api/admin.ts).
//
// Agreement template CRUD + the unified send flow (all sends route through the
// envelope model via findOrCreate) + inspector pre-sign. Route definitions are
// co-located with their `.openapi()` handlers. Mounted at `/` by the admin
// aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import * as schema from '../../lib/db/schema';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, resolveTenantSlug } from '../../lib/url';
import { lookupSenderSignature, buildSignUrl } from '../../lib/signature-helpers';
import { getTenantId } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
    AgreementSchema,
    SendAgreementSchema,
    AgreementListResponseSchema,
    AgreementResponseSchema,
    InspectorSignSchema,
} from '../../lib/validations/admin.schema';
import { applyInspectorPreSign } from '../../services/agreement.service';
import { SigningKeyService } from '../../services/signing-key.service';
import { AuditLogService } from '../../services/audit-log.service';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";


/**
 * GET Agreements
 */
const listAgreementsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements',
    tags: ["admin"],
    summary: "List tenant agreements for current tenant",
    middleware: [requireRole('owner', 'manager')],
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


const createAgreementRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements',
    tags: ["admin"],
    summary: "Create tenant agreements for current tenant",
    middleware: [requireRole('owner', 'manager')],
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


const updateAgreementRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/agreements/{id}',
    tags: ["admin"],
    summary: "Update tenant agreement for current tenant",
    middleware: [requireRole('owner', 'manager')],
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


const deleteAgreementRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/agreements/{id}',
    tags: ["admin"],
    summary: "Delete tenant agreement for current tenant",
    middleware: [requireRole('owner', 'manager')],
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


// --- Agreement Signing ---

const sendAgreementRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements/send',
    tags: ["admin", "agreements"],
    summary: 'Send an agreement signing request to a client',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SendAgreementSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            // All sends go through the envelope model. Response always carries
            // requestId + signer statuses — NO token material.
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.object({
                    requestId: z.string(),
                    signers: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), status: z.string() })),
                }),
            }) } },
            description: 'Signing request created and email sent',
        },
    },
    operationId: "sendTenant",
    description: "Auto-generated placeholder for sendTenant (POST /agreements/send, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const inspectorSignRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/agreement-requests/{id}/inspector-sign',
    tags: ['admin'],
    summary: 'Inspector pre-signs an agreement before sending to client',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: {
        params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }),
        body: { content: { 'application/json': { schema: InspectorSignSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Signed' },
        409: { description: 'Envelope not in pending status' },
    },
    operationId: 'inspectorPreSignAgreement',
    description: 'Spec 5H D1 — optional inspector pre-sign. Allowed only while envelope is pending.',
}, { scopes: ['admin'], tier: 'extended' }));


const adminAgreementsRoutes = createApiRouter()
    .openapi(listAgreementsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const agreementService = c.var.services.agreement;
        return c.json({ success: true, data: await agreementService.listAgreements(tenantId) }, 200);
    })
    .openapi(createAgreementRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const agreementService = c.var.services.agreement;
        const agreement = await agreementService.createAgreement(tenantId, body.name, body.content);
        return c.json({ success: true, data: { agreement: agreement } }, 201);
    })
    .openapi(updateAgreementRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const agreementService = c.var.services.agreement;
        const agreement = await agreementService.updateAgreement(id, tenantId, body.name, body.content);
        return c.json({ success: true, data: { agreement: agreement } }, 200);
    })
    .openapi(deleteAgreementRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const agreementService = c.var.services.agreement;
        await agreementService.deleteAgreement(id, tenantId);
        return c.json({ success: true }, 200);
    })
    .openapi(sendAgreementRoute, async (c) => {
        const tenantId = getTenantId(c);
        const body = c.req.valid('json');
        const svc = c.var.services.agreement;
        const tenantSlug = await resolveTenantSlug(c, tenantId);

        // One send model: normalize any recipient set into `signers`. A single
        // `clientEmail` recipient becomes a one-signer envelope (completionPolicy
        // 'one'); an explicit `signers` list keeps its policy (default 'all').
        const signers =
            body.signers && body.signers.length > 0
                ? body.signers.map((s) => ({
                    name: s.name,
                    email: s.email,
                    ...(s.role ? { role: s.role } : {}),
                    ...(s.contactId !== undefined ? { contactId: s.contactId } : {}),
                }))
                : body.clientEmail
                    ? [{ name: body.clientName ?? body.clientEmail, email: body.clientEmail, role: 'client' as const }]
                    : [];

        if (signers.length === 0) {
            throw Errors.BadRequest('Provide clientEmail or a non-empty signers list.');
        }
        // inspection_id is required for every envelope (schema-enforced; see SendAgreementSchema).
        const inspectionId = body.inspectionId;
        if (!inspectionId) {
            throw Errors.BadRequest('inspectionId is required to send an agreement.');
        }

        const completionPolicy =
            body.completionPolicy ?? (signers.length === 1 ? 'one' : 'all');

        const env = await svc.findOrCreate(tenantId, inspectionId, { agreementId: body.agreementId, signers, completionPolicy });

        const sigInspector = await lookupSenderSignature(c, tenantId);
        const signerRows = await svc.listSigners(tenantId, env.requestId);

        // Audit: envelope created (best-effort).
        try {
            await c.var.services.auditLog.append(tenantId, env.requestId, 'request.created', {
                actorId: c.get('user')?.sub ?? null,
                agreementId: body.agreementId,
                envelopeId: env.requestId,
                inspectionId,
                signerCount: signerRows.length,
                tenantId,
                tsMs: Date.now(),
            });
        } catch (e) {
            logger.warn('audit.append.created.failed', { requestId: env.requestId, error: (e as Error).message });
        }

        // Email each signer their own persistent link (per-signer token → per-signer URL).
        for (const s of signerRows) {
            let signUrl: string;
            try {
                const token = await svc.getSignerLink(tenantId, env.requestId, s.id);
                signUrl = await buildSignUrl(c, tenantId, inspectionId, tenantSlug, token);
            } catch (e) {
                logger.warn('agreement.signer.link.failed', { signerId: s.id, error: (e as Error).message });
                continue;
            }
            await c.var.services.email
                .sendAgreementRequest(s.email, s.name, 'Agreement', signUrl, sigInspector, getBookingHost(c))
                .catch((e: unknown) => logger.error('Failed to send agreement email', {}, e instanceof Error ? e : undefined));
        }

        try {
            await c.var.services.auditLog.append(tenantId, env.requestId, 'request.sent', {
                envelopeId: env.requestId,
                recipientCount: signerRows.length,
                tsMs: Date.now(),
            });
        } catch (e) {
            logger.warn('audit.append.sent.failed', { requestId: env.requestId, error: (e as Error).message });
        }

        auditFromContext(c, 'agreement.send', 'agreement_request', {
            metadata: { agreementId: body.agreementId, inspectionId, signers: signerRows.length },
        });
        return c.json({
            success: true as const,
            data: {
                requestId: env.requestId,
                signers: signerRows.map((s: typeof schema.agreementSigners.$inferSelect) => ({
                    id: s.id, name: s.name, email: s.email, role: s.role, status: s.status,
                })),
            },
        }, 200);
    })
    .openapi(inspectorSignRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { signatureBase64 } = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub ?? '';
        try {
            await applyInspectorPreSign(c.env.DB, tenantId, id, userId, signatureBase64);
        } catch (e) {
            const msg = (e as Error).message;
            if (msg.includes('not found')) throw Errors.NotFound(msg);
            if (msg.includes('can only pre-sign')) {
                return c.json({ success: false, error: { code: 'invalid_state', message: msg } }, 409);
            }
            throw e;
        }
        const signing = new SigningKeyService(c.env.DB, c.env.KEY_ENCRYPTION_SECRET || c.env.JWT_SECRET);
        const auditLog = new AuditLogService(c.env.DB, signing);
        await auditLog.append(tenantId, id, 'agreement.inspector_signed', {
            inspectorUserId: userId,
            tsMs: Date.now(),
        });
        return c.json({ success: true as const }, 200);
    });

export default adminAgreementsRoutes;
