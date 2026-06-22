// Admin → E-sign envelopes sub-router (Phase 1.3 split of server/api/admin.ts).
//
// Multi-signer signing-request views: list envelopes, envelope detail with
// audit trail, downloadable audit-trail JSON, per-signer list / remind /
// copy-link. Route definitions are co-located with their `.openapi()`
// handlers; bodies are byte-identical to the original admin.ts. Mounted at `/`
// by the admin aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, asc as ascDz, desc as descDz, eq as eqDz, sql as sqlTpl } from 'drizzle-orm';
import * as schema from '../../lib/db/schema';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, resolveTenantSlug } from '../../lib/url';
import { lookupSenderSignature, buildSignUrl } from '../../lib/signature-helpers';
import { getTenantId } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { agreements as agreementsTable, agreementRequests as agreementRequestsTable } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";


// --- Spec 5H — Signing Requests admin views ---

const listSigningRequestsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests',
    tags: ["admin"],
    summary: 'List signing requests for tenant',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.array(z.unknown()).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'OK' },
    },
    operationId: "listTenantAgreementsRequests",
    description: "Auto-generated placeholder for listTenantAgreementsRequests (GET /agreements/requests, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

const getSigningRequestDetailRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests/{id}',
    tags: ["admin"],
    summary: 'Get a signing request with full audit trail',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.unknown().describe('TODO describe data field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false).describe('TODO describe success field for the OpenInspection MCP integration'), error: z.unknown().describe('TODO describe error field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Not found' },
    },
    operationId: "getTenantAgreementsRequest",
    description: "Auto-generated placeholder for getTenantAgreementsRequest (GET /agreements/requests/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

const downloadAuditTrailRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests/{id}/audit-trail',
    tags: ["admin"],
    summary: 'Download audit trail JSON for legal evidence',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.unknown().describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Audit JSON download' },
    },
    operationId: "listTenantAgreementsRequestsAuditTrail",
    description: "Auto-generated placeholder for listTenantAgreementsRequestsAuditTrail (GET /agreements/requests/{id}/audit-trail, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

// --- Track I-a Task 9 — per-signer admin views (multi-signer envelope) ---

// A signer row as surfaced to the admin UI. NO token material (tokenHash /
// tokenEnc / token) is ever included — the only endpoint that returns a
// token-bearing string is the explicit copy-link route below.
const SignerRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    status: z.string(),
    channel: z.string().nullable(),
    signedAt: z.number().nullable(),
    viewedAt: z.number().nullable(),
    onBehalfOf: z.string().nullable(),
    lastRemindedAt: z.number().nullable(),
}).openapi('AgreementSignerRow');

const listSignersRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests/{requestId}/signers',
    tags: ["admin", "agreements"],
    summary: 'List signers of an agreement envelope (no token material)',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ requestId: z.string().describe('The agreement envelope (agreement_requests) id whose signers to list') }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(SignerRowSchema) }) } }, description: 'OK' },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.unknown() }) } }, description: 'Not found' },
    },
    operationId: "listTenantAgreementsRequestSigners",
    description: "List the signers of an agreement envelope with status/role/lastRemindedAt. Token material is never returned."
}, { scopes: ['admin'], tier: 'extended' }));

const remindSignerRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements/requests/{requestId}/signers/{signerId}/remind',
    tags: ["admin", "agreements"],
    summary: 'Re-send the agreement request to a single signer',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ requestId: z.string().describe('The agreement envelope id that owns the signer being reminded'), signerId: z.string().describe('The agreement_signers id to re-send the request to') }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ remindedAt: z.number() }) }) } }, description: 'Reminder sent' },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.unknown() }) } }, description: 'Not found' },
        409: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.unknown() }) } }, description: 'Signer is in a terminal state' },
        429: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.unknown() }) } }, description: 'Reminded too recently' },
    },
    operationId: "remindTenantAgreementsRequestSigner",
    description: "Re-send the agreement-request email to a single signer using their persistent link. Rate-limited to once per hour; terminal signers reject with 409."
}, { scopes: ['admin'], tier: 'extended' }));

const getSignerLinkRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/requests/{requestId}/signers/{signerId}/link',
    tags: ["admin", "agreements"],
    summary: 'Get a single signer\'s persistent public link (copy-link)',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ requestId: z.string().describe('The agreement envelope id that owns the signer whose link is requested'), signerId: z.string().describe('The agreement_signers id whose persistent public link to return') }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ url: z.string() }) }) } }, description: 'OK' },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.unknown() }) } }, description: 'Not found' },
    },
    operationId: "getTenantAgreementsRequestSignerLink",
    description: "Return the persistent (non-rotated) public link for a single signer. Authed + tenant-scoped; the only admin endpoint that returns a token-bearing URL."
}, { scopes: ['admin'], tier: 'extended' }));


export const adminEsignRoutes = createApiRouter()
    .openapi(listSigningRequestsRoute, async (c) => {
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

        // Track I-a Task 9 — per-envelope signer progress in ONE grouped query
        // (GROUP BY request_id), no N+1 per row. Merge into the list by id.
        const counts = await db
            .select({
                requestId: schema.agreementSigners.requestId,
                total: sqlTpl<number>`count(*)`,
                signed: sqlTpl<number>`sum(case when ${schema.agreementSigners.status} = 'signed' then 1 else 0 end)`,
            })
            .from(schema.agreementSigners)
            .where(eqDz(schema.agreementSigners.tenantId, tenantId))
            .groupBy(schema.agreementSigners.requestId);
        const byReq = new Map(counts.map((r) => [r.requestId, r]));
        const data = rows.map((r) => {
            const c2 = byReq.get(r.id);
            return {
                ...r,
                signersTotal: Number(c2?.total ?? 0),
                signersSigned: Number(c2?.signed ?? 0),
            };
        });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(getSigningRequestDetailRoute, async (c) => {
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
    })
    .openapi(downloadAuditTrailRoute, async (c) => {
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
    })
    // --- Track I-a Task 9 — per-signer admin endpoints --------------------
    .openapi(listSignersRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { requestId } = c.req.valid('param');
        const svc = c.var.services.agreement;
        // Tenant scope: confirm the envelope belongs to this tenant (404 otherwise).
        const env = await drizzle(c.env.DB, { schema }).select({ id: schema.agreementRequests.id })
            .from(schema.agreementRequests)
            .where(and(eqDz(schema.agreementRequests.id, requestId), eqDz(schema.agreementRequests.tenantId, tenantId)))
            .get();
        if (!env) throw Errors.NotFound('Signing request not found');
        const signers = await svc.listSigners(tenantId, requestId);
        // Map to the safe row shape — NEVER include tokenHash / tokenEnc.
        const data = signers.map((s: typeof schema.agreementSigners.$inferSelect) => ({
            id: s.id,
            name: s.name,
            email: s.email,
            role: s.role,
            status: s.status,
            channel: s.channel ?? null,
            signedAt: s.signedAt ? s.signedAt.getTime() : null,
            viewedAt: s.viewedAt ? s.viewedAt.getTime() : null,
            onBehalfOf: s.onBehalfOf ?? null,
            lastRemindedAt: s.lastRemindedAt ? s.lastRemindedAt.getTime() : null,
        }));
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(getSignerLinkRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { requestId, signerId } = c.req.valid('param');
        const svc = c.var.services.agreement;
        const db = drizzle(c.env.DB, { schema });
        // Tenant scope on the signer row (tenantId + requestId both pinned).
        const signer = await db.select({ id: schema.agreementSigners.id, requestId: schema.agreementSigners.requestId, inspectionId: schema.agreementRequests.inspectionId })
            .from(schema.agreementSigners)
            .innerJoin(schema.agreementRequests, eqDz(schema.agreementSigners.requestId, schema.agreementRequests.id))
            .where(and(
                eqDz(schema.agreementSigners.id, signerId),
                eqDz(schema.agreementSigners.requestId, requestId),
                eqDz(schema.agreementSigners.tenantId, tenantId),
            ))
            .get();
        if (!signer) throw Errors.NotFound('Signer not found');
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const token = await svc.getSignerLink(tenantId, requestId, signerId);
        const url = await buildSignUrl(c, tenantId, signer.inspectionId, tenantSlug, token);
        return c.json({ success: true as const, data: { url } }, 200);
    })
    .openapi(remindSignerRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { requestId, signerId } = c.req.valid('param');
        const svc = c.var.services.agreement;
        const db = drizzle(c.env.DB, { schema });
        // Tenant scope + load the signer row (need status + lastRemindedAt + inspectionId).
        const row = await db.select({
            id: schema.agreementSigners.id,
            name: schema.agreementSigners.name,
            email: schema.agreementSigners.email,
            status: schema.agreementSigners.status,
            lastRemindedAt: schema.agreementSigners.lastRemindedAt,
            inspectionId: schema.agreementRequests.inspectionId,
        })
            .from(schema.agreementSigners)
            .innerJoin(schema.agreementRequests, eqDz(schema.agreementSigners.requestId, schema.agreementRequests.id))
            .where(and(
                eqDz(schema.agreementSigners.id, signerId),
                eqDz(schema.agreementSigners.requestId, requestId),
                eqDz(schema.agreementSigners.tenantId, tenantId),
            ))
            .get();
        if (!row) throw Errors.NotFound('Signer not found');
        // Terminal signers can't be reminded.
        if (['signed', 'declined', 'expired'].includes(row.status)) {
            throw Errors.Conflict('Signer is no longer awaiting signature');
        }
        // Rate limit: at most once per hour, measured against lastRemindedAt.
        const now = Date.now();
        if (row.lastRemindedAt && now - row.lastRemindedAt.getTime() < 3600_000) {
            throw Errors.RateLimited('This signer was reminded within the last hour.');
        }

        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const token = await svc.getSignerLink(tenantId, requestId, signerId);
        const signUrl = await buildSignUrl(c, tenantId, row.inspectionId, tenantSlug, token);
        const sigInspector = await lookupSenderSignature(c, tenantId);
        await c.var.services.email.sendAgreementRequest(row.email, row.name, 'Agreement', signUrl, sigInspector, getBookingHost(c))
            .catch((e: unknown) => logger.error('Failed to send agreement reminder', {}, e instanceof Error ? e : undefined));

        await db.update(schema.agreementSigners).set({ lastRemindedAt: new Date(now) })
            .where(eqDz(schema.agreementSigners.id, signerId));

        try {
            await c.var.services.auditLog.append(tenantId, requestId, 'signer.reminded', {
                envelopeId: requestId,
                signerId,
                recipientEmail: row.email,
                tsMs: now,
            });
        } catch (e) {
            logger.warn('audit.append.reminded.failed', { requestId, error: (e as Error).message });
        }

        auditFromContext(c, 'agreement.remind', 'agreement_request', { metadata: { requestId, signerId } });
        return c.json({ success: true as const, data: { remindedAt: now } }, 200);
    });

export type AdminEsignApi = typeof adminEsignRoutes;
export default adminEsignRoutes;
