// Commercial PCA Phase M Task 6 — compliance API routes: dual sign-off
// (ASTM §7.5/§7.6), Pre-Survey Questionnaire (§8.5), Document Review
// checklist (§8.6), and the derived conformance verdict (§7). Delegates all
// persistence to ComplianceService (Task 5, c.var.services.compliance);
// this router owns only the tier guard, the conformance computation, and the
// PSQ-declined -> Deviations disclosure side effect (Phase S's
// appendDeviation, via InspectionService — see inspection-results.service.ts).
//
// Mirrors the OpenAPI + response-envelope convention established by the
// sibling cost-items router (./cost-items.ts): getTenantId(c)/getDrizzle(c),
// explicit z.object response schemas, `success: true as const`.
import { createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { inspections, reportSignoff, psqResponses } from '../../lib/db/schema';
import { resolveReportTier } from '../../lib/report-tier';
import { computeConformance, deriveConformanceInput } from '../../lib/pca-conformance';
import {
    SignoffBodySchema,
    DocReviewPatchSchema,
    PsqUpsertSchema,
    PsqStatusSchema,
    ComplianceResponseSchema,
    ReportSignoffRowSchema,
} from '../../lib/validations/compliance.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const ParamsId = z.object({ id: z.string().describe('Inspection identifier') });
const ParamsIdRole = z.object({
    id: z.string().describe('Inspection identifier'),
    role: z.enum(['field_observer', 'pcr_reviewer']).describe('Sign-off role to remove'),
});
const ParamsIdDocKey = z.object({
    id: z.string().describe('Inspection identifier'),
    documentKey: z.string().min(1).describe('Document Review catalog key'),
});

// ── tier guard ───────────────────────────────────────────────────────────────

/**
 * Loads the columns the compliance routes need to gate + score conformance
 * in a single tenant-scoped read: property type + stored tier (for the tier
 * guard) and the Deviations store (for the GET conformance computation).
 */
async function loadComplianceContext(db: ReturnType<typeof getDrizzle>, id: string, tenantId: string) {
    const row = await db.select({
        propertyType: inspections.propertyType,
        reportTier: inspections.reportTier,
        deviations: inspections.deviations,
    }).from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    if (!row) throw Errors.NotFound('Inspection not found');
    return row;
}

/**
 * Sign-off and PSQ writes require the inspection to already be elevated to
 * the full ASTM E2018 PCA tier (Phase T) — a light_commercial report has no
 * compliance surface. 409 TIER_NOT_FULL_PCA otherwise.
 */
function assertFullPcaTier(row: { propertyType: string | null; reportTier: 'light_commercial' | 'full_pca' | null }): void {
    const tier = resolveReportTier({ propertyType: row.propertyType, storedTier: row.reportTier });
    if (tier !== 'full_pca') throw Errors.TierNotFullPca();
}

// ── response serialization (Date -> epoch-ms) ───────────────────────────────
// `signed_at` / `sent_at` / `received_at` / `updated_at` are drizzle
// `timestamp_ms` columns — reads yield Date instances (see
// ComplianceService's own comment on this). The wire contract is epoch-ms
// numbers (schema-normalization convention; mirrors admin-esign.ts).

function toMs(v: Date | number | null): number | null {
    return v === null ? null : (v instanceof Date ? v.getTime() : v);
}

function serializeSignoff(row: typeof reportSignoff.$inferSelect) {
    return { ...row, signedAt: toMs(row.signedAt) as number };
}

function serializePsq(row: typeof psqResponses.$inferSelect | null) {
    if (!row) return null;
    return {
        ...row,
        sentAt: toMs(row.sentAt),
        receivedAt: toMs(row.receivedAt),
        updatedAt: toMs(row.updatedAt) as number,
    };
}

// ── routes ───────────────────────────────────────────────────────────────────

const getComplianceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/compliance',
    tags: ['inspections'],
    summary: 'Get inspection compliance artifacts',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsId },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: ComplianceResponseSchema }) } },
            description: 'Dual sign-offs, PSQ, document review checklist, and the derived ASTM E2018 conformance verdict.',
        },
    },
    operationId: 'getInspectionCompliance',
    description: 'Returns the ASTM E2018 compliance artifacts for the inspection — dual sign-off attestations, the Pre-Survey Questionnaire, the Document Review checklist, and the derived conformance verdict computed from all three plus the Deviations store.',
}, { scopes: ['read'], tier: 'extended' }));

const signoffRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/compliance/signoff',
    tags: ['inspections'],
    summary: 'Record a dual sign-off attestation',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsId,
        body: { content: { 'application/json': { schema: SignoffBodySchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: ReportSignoffRowSchema }) } },
            description: 'The recorded (or re-signed) attestation.',
        },
        409: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ code: z.literal('TIER_NOT_FULL_PCA'), message: z.string() }) }) } }, description: 'Inspection is not report_tier=full_pca.' },
    },
    operationId: 'signInspectionCompliance',
    description: 'Signs a dual sign-off attestation (field_observer or pcr_reviewer) with the tenant Ed25519 signing key. Re-signing the same role upserts and replaces the prior attestation. Requires report_tier=full_pca.',
}, { scopes: ['write'], tier: 'extended' }));

const removeSignoffRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}/compliance/signoff/{role}',
    tags: ['inspections'],
    summary: 'Remove a dual sign-off attestation',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsIdRole },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Delete acknowledged.' },
        409: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ code: z.literal('TIER_NOT_FULL_PCA'), message: z.string() }) }) } }, description: 'Inspection is not report_tier=full_pca.' },
    },
    operationId: 'removeInspectionComplianceSignoff',
    description: 'Removes the sign-off attestation for the given role. Requires report_tier=full_pca.',
}, { scopes: ['write'], tier: 'extended' }));

const seedDocReviewRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/compliance/doc-review/seed',
    tags: ['inspections'],
    summary: 'Seed the Document Review checklist',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsId },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Seed acknowledged (idempotent — already-seeded keys are skipped).' },
    },
    operationId: 'seedInspectionComplianceDocReview',
    description: 'Seeds the Document Review checklist (ASTM §8.6) from the platform catalog. Idempotent — items already present for this inspection are left untouched.',
}, { scopes: ['write'], tier: 'extended' }));

const patchDocReviewItemRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/compliance/doc-review/{documentKey}',
    tags: ['inspections'],
    summary: 'Patch a Document Review checklist item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsIdDocKey,
        body: { content: { 'application/json': { schema: DocReviewPatchSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Update acknowledged.' },
    },
    operationId: 'patchInspectionComplianceDocReviewItem',
    description: 'Patches requested/received/reviewed/na/notes on a single Document Review checklist item.',
}, { scopes: ['write'], tier: 'extended' }));

const upsertPsqRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/{id}/compliance/psq',
    tags: ['inspections'],
    summary: 'Upsert Pre-Survey Questionnaire responses',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsId,
        body: { content: { 'application/json': { schema: PsqUpsertSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Responses stored; status transitions to received.' },
        409: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ code: z.literal('TIER_NOT_FULL_PCA'), message: z.string() }) }) } }, description: 'Inspection is not report_tier=full_pca.' },
    },
    operationId: 'upsertInspectionCompliancePsq',
    description: 'Stores the Pre-Survey Questionnaire responses (ASTM §8.5) and transitions status to received. Requires report_tier=full_pca.',
}, { scopes: ['write'], tier: 'extended' }));

const setPsqStatusRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/compliance/psq/status',
    tags: ['inspections'],
    summary: 'Set Pre-Survey Questionnaire status',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsId,
        body: { content: { 'application/json': { schema: PsqStatusSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Status updated. Declining also discloses the omission in the Deviations store.' },
        409: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ code: z.literal('TIER_NOT_FULL_PCA'), message: z.string() }) }) } }, description: 'Inspection is not report_tier=full_pca.' },
    },
    operationId: 'setInspectionCompliancePsqStatus',
    description: 'Sets the PSQ status (sent/received/declined). Declining automatically appends a Deviations disclosure (ASTM §11.4.3) so the omission is stated, not silently dropped. Requires report_tier=full_pca.',
}, { scopes: ['write'], tier: 'extended' }));

// ── handlers ─────────────────────────────────────────────────────────────────

const complianceRoutes = createApiRouter()
    .openapi(getComplianceRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const db = getDrizzle(c);

        const ctx = await loadComplianceContext(db, id, tenantId);
        const { reportSignoffs, psq, documentReview } = await c.var.services.compliance.getCompliance(tenantId, id);

        const deviations = ctx.deviations ?? [];
        const psqDisclosedInDeviations = deviations.some((d) => d.area === 'PSQ');
        const conformance = computeConformance(deriveConformanceInput({
            reportSignoffs,
            deviations,
            psqStatus: psq?.status ?? null,
            psqDisclosedInDeviations,
        }));

        return c.json({
            success: true as const,
            data: {
                reportSignoffs: reportSignoffs.map(serializeSignoff),
                psq: serializePsq(psq),
                documentReview,
                conformance,
            },
        }, 200);
    })
    .openapi(signoffRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const db = getDrizzle(c);

        const ctx = await loadComplianceContext(db, id, tenantId);
        assertFullPcaTier(ctx);

        const row = await c.var.services.compliance.signOff(tenantId, id, {
            role: body.role,
            personId: body.personId,
            name: body.name,
            license: body.license ?? null,
            qualificationsRef: body.qualificationsRef ?? null,
            dualRole: body.dualRole ?? false,
        });
        auditFromContext(c, 'inspection.compliance.signoff', 'inspection', {
            entityId: id,
            metadata: { role: body.role, dualRole: body.dualRole ?? false },
        });
        return c.json({ success: true as const, data: row }, 200);
    })
    .openapi(removeSignoffRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, role } = c.req.valid('param');
        const db = getDrizzle(c);

        const ctx = await loadComplianceContext(db, id, tenantId);
        assertFullPcaTier(ctx);

        await c.var.services.compliance.removeSignOff(tenantId, id, role);
        auditFromContext(c, 'inspection.compliance.signoff_removed', 'inspection', { entityId: id, metadata: { role } });
        return c.json({ success: true as const }, 200);
    })
    .openapi(seedDocReviewRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        await c.var.services.compliance.seedDocumentReview(tenantId, id);
        auditFromContext(c, 'inspection.compliance.doc_review_seeded', 'inspection', { entityId: id });
        return c.json({ success: true as const }, 200);
    })
    .openapi(patchDocReviewItemRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, documentKey } = c.req.valid('param');
        const patch = c.req.valid('json');
        await c.var.services.compliance.updateDocumentReviewItem(tenantId, id, documentKey, patch);
        auditFromContext(c, 'inspection.compliance.doc_review_updated', 'inspection', {
            entityId: id,
            metadata: { documentKey, fields: Object.keys(patch) },
        });
        return c.json({ success: true as const }, 200);
    })
    .openapi(upsertPsqRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { responses } = c.req.valid('json');
        const db = getDrizzle(c);

        const ctx = await loadComplianceContext(db, id, tenantId);
        assertFullPcaTier(ctx);

        await c.var.services.compliance.upsertPsq(tenantId, id, responses);
        auditFromContext(c, 'inspection.compliance.psq_updated', 'inspection', { entityId: id });
        return c.json({ success: true as const }, 200);
    })
    .openapi(setPsqStatusRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { status, reason } = c.req.valid('json');
        const db = getDrizzle(c);

        const ctx = await loadComplianceContext(db, id, tenantId);
        assertFullPcaTier(ctx);

        await c.var.services.compliance.setPsqStatus(tenantId, id, status);

        // A declined PSQ is a mandatory-exhibit omission (ASTM §8.5) — disclose
        // it in the Deviations store (Phase S) so §11.4.3 conformance can still
        // be claimed once every other gate passes. appendDeviation is
        // idempotent, so re-declining never duplicates the disclosure.
        if (status === 'declined') {
            await c.var.services.inspection.appendDeviation(id, tenantId, {
                area: 'PSQ',
                baselineRequirement: 'ASTM §8.5 Pre-Survey Questionnaire included as exhibit',
                deviation: 'PSQ not obtained from point-of-contact',
                reason: reason ?? '(no reason provided)',
            });
        }

        auditFromContext(c, 'inspection.compliance.psq_status_changed', 'inspection', { entityId: id, metadata: { status } });
        return c.json({ success: true as const }, 200);
    });

export default complianceRoutes;
