// Admin → Agreements sub-router (Phase 1.3 split of server/api/admin.ts).
//
// Agreement template CRUD + the send flow (single-recipient + multi-signer
// envelope) + inspector pre-sign. Route definitions are co-located with their
// `.openapi()` handlers; bodies are byte-identical to the original admin.ts.
// Mounted at `/` by the admin aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../lib/db/schema';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, resolveTenantSlug } from '../../lib/url';
import { agreementSignUrl, checkoutUrl } from '../../lib/public-urls';
import { shouldUseCheckoutLink } from '../../lib/agreement-link';
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
            // Track I-a Task 9 — two shapes: legacy single-recipient
            // ({ token, signUrl }) and the multi-signer envelope
            // ({ requestId, signers }). The latter carries NO token material.
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.union([
                    z.object({ token: z.string(), signUrl: z.string() }),
                    z.object({
                        requestId: z.string(),
                        signers: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), status: z.string() })),
                    }),
                ]),
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


export const adminAgreementsRoutes = createApiRouter()
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

        // Track I-a Task 9 — multi-signer envelope path. When `signers` is
        // provided AND the request is bound to an inspection, route through
        // findOrCreate so signer rows + content snapshot are pinned, then email
        // each signer their OWN persistent link. The legacy single-recipient
        // path (no `signers`, or no inspection to key the envelope on) stays
        // untouched below.
        if (body.signers && body.signers.length > 0 && !body.inspectionId) {
            throw Errors.BadRequest('inspectionId is required when sending to multiple signers.');
        }

        if (body.signers && body.signers.length > 0 && body.inspectionId) {
            const env = await svc.findOrCreate(tenantId, body.inspectionId, {
                signers: body.signers.map((s) => ({
                    name: s.name,
                    email: s.email,
                    ...(s.role ? { role: s.role } : {}),
                    ...(s.contactId !== undefined ? { contactId: s.contactId } : {}),
                })),
                ...(body.completionPolicy ? { completionPolicy: body.completionPolicy } : {}),
            });

            const sigInspector = await lookupSenderSignature(c, tenantId);
            const signers = await svc.listSigners(tenantId, env.requestId);

            // Audit: envelope created (best-effort).
            try {
                await c.var.services.auditLog.append(tenantId, env.requestId, 'request.created', {
                    actorId: c.get('user')?.sub ?? null,
                    agreementId: body.agreementId,
                    envelopeId: env.requestId,
                    inspectionId: body.inspectionId,
                    signerCount: signers.length,
                    tenantId,
                    tsMs: Date.now(),
                });
            } catch (e) {
                logger.warn('audit.append.created.failed', { requestId: env.requestId, error: (e as Error).message });
            }

            // Email each signer their own link (per-signer token → per-signer URL).
            for (const s of signers) {
                let signUrl: string;
                try {
                    const token = await svc.getSignerLink(env.requestId, s.id);
                    signUrl = await buildSignUrl(c, tenantId, body.inspectionId, tenantSlug, token);
                } catch (e) {
                    logger.warn('agreement.signer.link.failed', { signerId: s.id, error: (e as Error).message });
                    continue;
                }
                await c.var.services.email.sendAgreementRequest(s.email, s.name, 'Agreement', signUrl, sigInspector, getBookingHost(c))
                    .catch((e: unknown) => logger.error('Failed to send agreement email', {}, e instanceof Error ? e : undefined));
            }

            try {
                await c.var.services.auditLog.append(tenantId, env.requestId, 'request.sent', {
                    envelopeId: env.requestId,
                    recipientCount: signers.length,
                    tsMs: Date.now(),
                });
            } catch (e) {
                logger.warn('audit.append.sent.failed', { requestId: env.requestId, error: (e as Error).message });
            }

            auditFromContext(c, 'agreement.send', 'agreement_request', { metadata: { agreementId: body.agreementId, inspectionId: body.inspectionId, signers: signers.length } });
            return c.json({
                success: true as const,
                data: {
                    requestId: env.requestId,
                    // Signer statuses only — NO token material in the response.
                    signers: signers.map((s: typeof schema.agreementSigners.$inferSelect) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status })),
                },
            }, 200);
        }

        // Legacy single-recipient path. `clientEmail` is schema-optional now
        // (the multi-signer path keys off `signers`), so guard it here: this
        // branch is only reached when no `signers`+`inspectionId` envelope was
        // built, in which case clientEmail is required to address the email.
        if (!body.clientEmail) {
            throw Errors.BadRequest('clientEmail is required for a single-signer send.');
        }
        const clientEmail = body.clientEmail;
        const request = await svc.createSigningRequest(tenantId, {
            agreementId: body.agreementId,
            clientEmail,
            ...(body.clientName !== undefined ? { clientName: body.clientName } : {}),
            ...(body.inspectionId !== undefined ? { inspectionId: body.inspectionId } : {}),
        });
        // Track I-a Task 8 — when the inspection requires payment AND has an
        // outstanding (unpaid) invoice, point the recipient at the combined
        // Sign & pay page; otherwise the standalone sign page.
        const signUrl = (await shouldUseCheckoutLink(c.env.DB, tenantId, body.inspectionId))
            ? checkoutUrl(getBookingHost(c), tenantSlug, request.token)
            : agreementSignUrl(getBookingHost(c), tenantSlug, request.token);

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
                clientEmail,
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
        let sigInspector: { name: string | null; email: string | null; phone: string | null; licenseNumber: string | null; signatureEnabled: boolean | null } | undefined;
        if (senderId) {
            try {
                const row = await drizzle(c.env.DB).select({
                    name:             schema.users.name,
                    email:            schema.users.email,
                    phone:            schema.users.phone,
                    licenseNumber:    schema.users.licenseNumber,
                    signatureEnabled: schema.users.signatureEnabled,
                }).from(schema.users)
                    .where(and(eq(schema.users.id, senderId), eq(schema.users.tenantId, tenantId)))
                    .get();
                sigInspector = row ?? undefined;
            } catch (err) {
                logger.warn('agreement.signature.lookup.failed', { senderId, error: (err as Error).message });
            }
        }

        await c.var.services.email.sendAgreementRequest(clientEmail, body.clientName ?? null, request.agreementName, signUrl, sigInspector, getBookingHost(c))
            .catch((e: unknown) => logger.error('Failed to send agreement email', {}, e instanceof Error ? e : undefined));

        // Append request.sent only after email is dispatched (or attempted)
        try {
            await c.var.services.auditLog.append(tenantId, request.id, 'request.sent', {
                envelopeId: request.id,
                recipientEmail: clientEmail,
                signUrl,
                tsMs: Date.now(),
            });
        } catch (e) {
            logger.warn('audit.append.sent.failed', { requestId: request.id, error: (e as Error).message });
        }

        auditFromContext(c, 'agreement.send', 'agreement_request', { metadata: { agreementId: body.agreementId, clientEmail } });
        return c.json({ success: true as const, data: { token: request.token, signUrl } }, 200);
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

export type AdminAgreementsApi = typeof adminAgreementsRoutes;
export default adminAgreementsRoutes;
