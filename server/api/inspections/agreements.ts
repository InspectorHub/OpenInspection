// Agreement signing envelope sub-router: create + email a signing request,
// check signed status, fetch the on-site signing surface, and submit an
// on-site signature. Split out of publish.ts so each file stays under the size
// ceiling. Behavior-preserving extraction from inspections.ts — handler bodies
// + route definitions are byte-identical to the original.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { resolveTenantSlug } from '../../lib/url';
import { emailSignersTheirLinks } from '../../lib/agreement-send';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { safeISODate } from '../../lib/date';
import { SendAgreementRequestSchema, AgreementRequestCreatedSchema } from '../../lib/validations/inspection.schema';
import { inspections as inspectionTable, agreements, agreementRequests } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveSignatureInspector } from '../../lib/signature-helpers';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';

/**
 * POST /api/inspections/:id/agreement-requests
 *
 * Task 7 (Issue #111) — the hub Agreement card "Send agreement" button. Creates
 * a signing request and emails it to the client. Both body fields are optional:
 * agreementId defaults to the tenant's first agreement template, email defaults
 * to the inspection's primary client (PeopleService.getPrimaryClient — Task 9b).
 * 422 when no template exists, no email is resolvable, or the supplied
 * agreementId does not belong to the tenant.
 */
const sendAgreementRequestRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/{id}/agreement-requests',
    tags: ['inspections'],
    summary: 'Create + email an agreement signing request for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier') }),
        body: { content: { 'application/json': { schema: SendAgreementRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AgreementRequestCreatedSchema } },
            description: 'Signing request created and emailed',
        },
        404: { description: 'Inspection not found in this tenant' },
        422: { description: 'No agreement template, no resolvable email, or agreement not in this tenant' },
    },
    operationId: 'createInspectionAgreementRequest',
    description: 'Creates an agreement signing request for the inspection, emails it to the client, marks it sent, and returns the created request.',
}, { scopes: ['write'], tier: 'extended' }));


const agreementsRoutes = createApiRouter()
    .openapi(sendAgreementRequestRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const body     = c.req.valid('json');
        const db       = getDrizzle(c);

        // 404 if the inspection is missing or belongs to another tenant.
        const inspection = await db.select().from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Resolve the agreement template: explicit id (tenant-scoped) or the
        // tenant's first agreement (same gatekeeper as GET .../agreement).
        let agreement;
        if (body.agreementId) {
            agreement = await db.select().from(agreements)
                .where(and(eq(agreements.id, body.agreementId), eq(agreements.tenantId, tenantId))).get();
            if (!agreement) throw Errors.UnprocessableEntity('The selected agreement template was not found in this workspace.');
        } else {
            agreement = await db.select().from(agreements)
                .where(eq(agreements.tenantId, tenantId)).get();
            if (!agreement) throw Errors.UnprocessableEntity('No agreement template exists yet. Create one in Settings before sending.');
        }

        // Resolve the recipient set. IA-65 — an explicit multi-party `signers`
        // list wins; otherwise fall back to the single `email` shorthand or the
        // inspection's primary client (Task 9b — inspection_people join via
        // PeopleService, not the legacy inspection.clientEmail column, which is
        // being dropped, Task 13).
        const client = await c.var.services.people.getPrimaryClient(tenantId, id);
        const requested = body.signers && body.signers.length > 0
            ? body.signers.map((s) => ({ name: s.name, email: s.email, role: s.role ?? ('client' as const) }))
            : (() => {
                const email = body.email ?? client?.email ?? null;
                if (!email) return [];
                return [{ name: client?.name ?? email, email, role: 'client' as const }];
            })();
        if (requested.length === 0) throw Errors.UnprocessableEntity('No client email on this inspection. Add a client email or enter one to send.');

        // One send model: create (or reuse) the inspection's envelope with this
        // signer set, then email every signer their own persistent link. A lone
        // signer defaults to 'one' (nobody else can complete it); a multi-party
        // send defaults to 'all' unless the caller says otherwise.
        const completionPolicy = body.completionPolicy ?? (requested.length === 1 ? 'one' : 'all');
        const env = await c.var.services.agreement.findOrCreate(tenantId, id, {
            agreementId: agreement.id,
            signers: requested,
            completionPolicy,
        });

        const signers = await c.var.services.agreement.listSigners(tenantId, env.requestId);
        const clientEmail = signers[0]?.email ?? requested[0].email;

        // Email each signer their own link. Uses the saas-aware slug resolver
        // (requestedTenantSlug is empty in saas → DB fallback) and signs with
        // the assigned inspector's rebooking footer (B-4a).
        await emailSignersTheirLinks(c, {
            tenantId,
            inspectionId: id,
            tenantSlug: await resolveTenantSlug(c, tenantId),
            requestId: env.requestId,
            agreementName: agreement.name,
            senderSignature: await resolveSignatureInspector(c, inspection.inspectorId, tenantId),
            signers,
        });

        // findOrCreate already sets status: 'sent' — no manual update needed.

        // Fetch the envelope row so we can return the real createdAt (not
        // wall-clock). On the reuse path, alreadyExists: true but findOrCreate
        // does not expose the original timestamp.
        const envelopeRow = await db
            .select({ createdAt: agreementRequests.createdAt })
            .from(agreementRequests)
            .where(and(eq(agreementRequests.id, env.requestId), eq(agreementRequests.tenantId, tenantId)))
            .get();
        if (!envelopeRow) {
            logger.error('agreement.send.envelope-not-found', { requestId: env.requestId, tenantId });
            throw Errors.NotFound('Agreement request not found after creation');
        }

        auditFromContext(c, 'agreement.send', 'agreement_request', {
            entityId: env.requestId,
            metadata: {
                agreementId: agreement.id,
                clientEmail,
                inspectionId: id,
                signerCount: signers.length,
                // Reads back as "this send added N parties to a live envelope"
                // rather than "an envelope was sent" — the two are different
                // events to anyone reconstructing who was asked to sign, when.
                addedSigners: env.addedSignerIds.length,
            },
        });

        return c.json({
            success: true as const,
            data: {
                id:          env.requestId,
                status:      'sent',
                clientEmail,
                createdAt:   safeISODate(envelopeRow.createdAt),
                signerCount: signers.length,
                addedSigners: env.addedSignerIds.length,
            },
        }, 200);
    })
    .get('/:id/sign-status', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);

        // Track I-a — signed truth rides the envelope: a signed agreement_requests
        // row for this inspection (any channel — emailed OR on-site) lights it.
        const existing = await db.select({ id: agreementRequests.id }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();

        return c.json({ success: true, data: { signed: !!existing } }, 200);
    })
    .get('/:id/agreement', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);
        const svc = c.var.services.agreement;

        // Verify inspection exists (404 distinct from "no template").
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Track I-a — ride the envelope: find-or-create the signing request so the
        // on-site signing surface reads the SAME snapshot + signer set as the
        // emailed flow. No template configured → { agreement: null } as before.
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: true, data: { agreement: null } }, 200);
            }
            throw e;
        }

        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const snapshot = await svc.getSnapshotForRequest(envelope);
        const agreementRow = await db.select({ name: agreements.name }).from(agreements)
            .where(eq(agreements.id, envelope.agreementId)).get();
        const signerRows = await svc.listSigners(tenantId, env.requestId);

        return c.json({
            success: true,
            data: {
                // Backward-compatible subset: callers reading data.agreement.{id,name,content} still work.
                agreement: { id: envelope.agreementId, name: agreementRow?.name ?? 'Agreement', content: snapshot.content },
                requestId: env.requestId,
                completionPolicy: envelope.completionPolicy,
                signers: signerRows.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status })),
            },
        }, 200);
    })


export default agreementsRoutes;
