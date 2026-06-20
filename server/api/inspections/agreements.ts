// Agreement signing envelope sub-router: create + email a signing request,
// check signed status, fetch the on-site signing surface, and submit an
// on-site signature. Split out of publish.ts so each file stays under the size
// ceiling. Behavior-preserving extraction from inspections.ts — handler bodies
// + route definitions are byte-identical to the original.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, resolveTenantSlug } from '../../lib/url';
import { agreementSignUrl } from '../../lib/public-urls';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { safeISODate } from '../../lib/date';
import { SendAgreementRequestSchema, AgreementRequestCreatedSchema } from '../../lib/validations/inspection.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, agreements, agreementRequests, agreementSigners } from '../../lib/db/schema';
import { runEnvelopeCompletionPipeline, runSignerReceiptEffects } from '../../lib/sign-effects';
import { eq, and, asc } from 'drizzle-orm';
import { resolveSignatureInspector } from '../../lib/signature-helpers';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * POST /api/inspections/:id/agreement-requests
 *
 * Task 7 (Issue #111) — the hub Agreement card "Send agreement" button. Creates
 * a signing request and emails it to the client. Both body fields are optional:
 * agreementId defaults to the tenant's first agreement template, email defaults
 * to the inspection's clientEmail. 422 when no template exists, no email is
 * resolvable, or the supplied agreementId does not belong to the tenant.
 */
export const sendAgreementRequestRoute = createRoute(withMcpMetadata({
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
        const db       = drizzle(c.env.DB);

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

        // Resolve the recipient: explicit email or the inspection's client email.
        const clientEmail = body.email ?? inspection.clientEmail ?? null;
        if (!clientEmail) throw Errors.UnprocessableEntity('No client email on this inspection. Add a client email or enter one to send.');

        // Create the signing request (tenant-scoped inside the service).
        const request = await c.var.services.agreement.createSigningRequest(tenantId, {
            agreementId: agreement.id,
            clientEmail,
            clientName: inspection.clientName ?? null,
            inspectionId: id,
        });

        // Build the public sign URL exactly like the admin send path.
        // Use the saas-aware resolver (requestedTenantSlug is empty in saas → DB fallback).
        const slug = await resolveTenantSlug(c, tenantId);
        const signUrl = agreementSignUrl(getBookingHost(c), slug, request.token);

        // Sign the email with the assigned inspector's rebooking footer (B-4a).
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        await c.var.services.email.sendAgreementRequest(
            clientEmail, inspection.clientName ?? null, request.agreementName, signUrl, sigInspector, getBookingHost(c),
        );

        // Flip the row to 'sent' (the admin path stamps a request.sent audit
        // event; the hub surfaces row status directly, so we persist it).
        const sentAt = new Date();
        await db.update(agreementRequests)
            .set({ status: 'sent', sentAt })
            .where(and(eq(agreementRequests.id, request.id), eq(agreementRequests.tenantId, tenantId)));

        auditFromContext(c, 'agreement.send', 'agreement_request', {
            entityId: request.id,
            metadata: { agreementId: agreement.id, clientEmail, inspectionId: id },
        });

        return c.json({
            success: true as const,
            data: {
                id:          request.id,
                status:      'sent',
                clientEmail,
                createdAt:   safeISODate(request.createdAt),
            },
        }, 200);
    })
    .get('/:id/sign-status', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

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
        const db = drizzle(c.env.DB);
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
    .post('/:id/sign', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const svc = c.var.services.agreement;

        // Verify inspection exists
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const raw = await c.req.json();
        const parsed = z.object({
            signatureBase64: z.string().min(1).describe('Base64-encoded signature image (data URL or raw base64) drawn by the signer on-site.'),
            signerId: z.string().optional().describe('Target signer within the envelope; defaults to the first non-terminal signer.'),
            onBehalfOf: z.string().max(200).optional().describe('Name of the party an authorized agent signs for.'),
            onBehalfDisclaimer: z.string().max(2000).optional().describe('Disclaimer the authorized agent attests to when signing on behalf of another.'),
        }).safeParse(raw);
        if (!parsed.success) return c.json({ success: false, error: { message: 'Invalid signature data', code: 'validation_error' } }, 400);
        const body = parsed.data;

        // Idempotency at the inspection level: if a signed envelope already
        // exists for this inspection, short-circuit (don't spin a fresh envelope).
        // Preserves the old `{ alreadySigned: true }` contract.
        const alreadySignedEnv = await db.select({ id: agreementRequests.id, status: agreementRequests.status })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();
        if (alreadySignedEnv) {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, envelopeStatus: 'signed' } }, 200);
        }

        // Track I-a — on-site signing rides the envelope so every signature carries
        // a snapshot + audit chain + receipt. An envelope requires a template; the
        // old flow recorded signatures against nothing (the legal hole we close).
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: false, error: { code: 'no_agreement_template', message: 'Create an agreement template before collecting signatures' } }, 409);
            }
            throw e;
        }

        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const signers = await db.select().from(agreementSigners)
            .where(eq(agreementSigners.requestId, env.requestId))
            .orderBy(asc(agreementSigners.createdAt)).all();

        // Pick the target signer: explicit signerId, else first non-terminal.
        let signer;
        if (body.signerId) {
            signer = signers.find((s) => s.id === body.signerId);
            if (!signer) throw Errors.NotFound('Signer not found');
        } else {
            signer = signers.find((s) => !['signed', 'declined', 'expired'].includes(s.status));
            if (!signer) {
                // Every signer is terminal — nothing left to sign.
                throw Errors.Conflict('Agreement is no longer signable');
            }
        }

        // Idempotent — an already-signed signer short-circuits without re-firing effects.
        if (signer.status === 'signed') {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, signerId: signer.id, envelopeStatus: envelope.status } }, 200);
        }

        // Terminal-state guard: declined / expired signers must never reach the audit append.
        if (signer.status === 'declined' || signer.status === 'expired') {
            throw Errors.Conflict('Agreement is no longer signable');
        }

        const plaintext = await svc.getSignerLink(env.requestId, signer.id);

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;
        const tsMs = Date.now();

        // Spec 5H P0 — audit-before-mutation per-signer append (chain integrity
        // survives a partial failure). Hash the signature image for cert reference.
        const sigBytes = (() => {
            try {
                const b64 = body.signatureBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
            } catch { return new Uint8Array(); }
        })();
        const sigHash = sigBytes.length > 0
            ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes)))
                .map((b) => b.toString(16).padStart(2, '0')).join('')
            : null;
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.signed', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                signerRole: signer.role,
                channel: 'in_person',
                contentHash: envelope.contentHash ?? null,
                onBehalfOf: body.onBehalfOf ?? null,
                country,
                ip,
                signatureImageHash: sigHash ? `sha256:${sigHash}` : null,
                tsMs,
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signer-signed.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }

        const result = await svc.markSignedBySigner(plaintext, body.signatureBase64, {
            signedAtMs: tsMs,
            channel: 'in_person',
            ipAddress: ip,
            userAgent: ua,
            onBehalfOf: body.onBehalfOf ?? null,
            onBehalfDisclaimer: body.onBehalfDisclaimer ?? null,
        });

        // Spec 2A — per-signer automation event (fires on EVERY sign).
        if (result.inspectionId) {
            c.var.services.automation.trigger({
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                triggerEvent: 'agreement.signer_signed',
                companyName: c.env.APP_NAME || 'OpenInspection',
                reportBaseUrl: c.env.APP_BASE_URL || '',
            }).catch(() => {});
        }

        // Envelope completion side-effects fire EXACTLY ONCE.
        if (result.envelopeCompletedNow) {
            await runEnvelopeCompletionPipeline(c, {
                requestId: result.requestId,
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                clientEmail: envelope.clientEmail ?? null,
                clientName: envelope.clientName ?? null,
                agreementId: envelope.agreementId,
            });
        }

        // Per-signer in-person receipt — every signer gets a receipt at their own
        // email EXCEPT when this same sign completed the envelope and the signer
        // IS the envelope client (the completion pipeline already emailed them).
        const completedSelf = result.envelopeCompletedNow
            && !!envelope.clientEmail
            && signer.email.trim().toLowerCase() === envelope.clientEmail.trim().toLowerCase();
        if (!completedSelf) {
            await runSignerReceiptEffects(c, {
                signerEmail: signer.email,
                signerName: signer.name,
                inspectionId: result.inspectionId,
                requestId: result.requestId,
            });
        }

        return c.json({ success: true, data: { signed: true, signerId: signer.id, envelopeStatus: result.envelopeStatus } }, 200);
    });

export default agreementsRoutes;
