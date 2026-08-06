// /api/inspections/:id/pay-splits — the read and write face for what each
// inspector earns on one job (#278).
//
// THE VISIBILITY RULE IS QUERY SCOPING, NOT A CAPABILITY. Spectora's shipped
// behaviour is "an inspector sees their own pay split on every inspection and
// cannot see or edit anyone else's"; that is a THIRD state — `financial: false`
// AND `subject = self` — and no boolean permission flag can express it. Housecall
// Pro and Jobber both fail to offer it for exactly that reason: their pay
// permissions are binary, so "see your own" has nowhere to live. Ours would be
// binary too if this were a capability, so the GET is gated on ROLE and the ROWS
// are filtered:
//
//   financial: true  (owner/manager) → every split on the inspection, editable
//   financial: false (inspector)     → only rows where user_id = the caller, read-only
//
// Deliberately NOT routed through `server/lib/auth/money-redaction.ts`. That
// redactor exists to stop an endpoint leaking the COMPANY's money to someone
// without `financial`; an endpoint that structurally returns only the caller's
// own row is not leaking, so there is nothing to exempt. Leaving the single
// shared redactor untouched is worth more than the convenience of reusing it.
//
// Naming: `amountCents` on this surface is PAY — what the worker is owed. The
// company-side figure ("attributed revenue") is a metrics concern and never
// appears here. Never "cost": the inspector reads this payload.
//
// Every write is `requireCapability('financial')` on top of the role gate. An
// inspector's own row is read-only to them, which is the competitor's rule and
// also the only defensible one — a wage nobody but its recipient can change is
// not an agreement.
//
// The route definitions are NAMED CONSTS rather than inlined into the chain,
// which is not a style preference: `scripts/check-idempotency-coverage.mjs`
// discovers routes by reading `.openapi(IDENT)` and resolving IDENT to a
// `const X = createRoute(...)`. A route written inline as
// `.openapi(createRoute(...), handler)` is INVISIBLE to that gate, so its retry
// story is never asked for. These are money routes; being invisible to the
// ledger is the one thing they may not be.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability, capabilitiesFor } from '../../lib/middleware/require-capability';
import { Errors } from '../../lib/errors';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import type { InspectionServicePaySplit } from '../../lib/db/schema';
import {
    getSplitsForInspection, setSplitManually, correctSplit, previewRefresh, refreshSplits,
} from '../../services/pay-split.service';
import {
    PaySplitListResponseSchema, PaySplitResponseSchema, RefreshPreviewResponseSchema,
    RefreshResultResponseSchema, SetPaySplitSchema, CorrectPaySplitSchema,
} from '../../lib/validations/pay-split.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const IdParam = z.object({
    id: z.string().trim().min(1).describe('Inspection id the pay rows belong to.'),
});

const SplitParam = IdParam.extend({
    splitId: z.string().trim().min(1).describe('inspection_service_pay_splits row id.'),
});

/** Epoch ms out, never Date — the wire shape matches the timestamp_ms columns. */
const toWire = (s: InspectionServicePaySplit) => ({
    id:                  s.id,
    inspectionServiceId: s.inspectionServiceId,
    userId:              s.userId,
    amountCents:         s.amountCents,
    source:              s.source,
    lockedAtMs:          s.lockedAt === null ? null : Number(s.lockedAt),
    correctsSplitId:     s.correctsSplitId,
    reason:              s.reason,
    createdAtMs:         Number(s.createdAt),
    updatedAtMs:         Number(s.updatedAt),
});

/**
 * A split id in the path must belong to the inspection in the path. Without
 * this the inspection segment is decoration and any tenant split could be
 * edited through any inspection's URL — the id would still be tenant-scoped,
 * but the audit trail would name the wrong job.
 */
async function requireOnInspection(
    db: ReturnType<typeof getDrizzle>, tenantId: string, inspectionId: string, splitId: string,
): Promise<void> {
    const rows = await getSplitsForInspection(db, tenantId, inspectionId);
    if (!rows.some(s => s.id === splitId)) throw Errors.NotFound('Pay split not found on this inspection');
}

const listPaySplitsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/pay-splits',
    tags: ['inspections'],
    summary: 'List pay splits for one inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: IdParam },
    responses: {
        200: { content: { 'application/json': { schema: PaySplitListResponseSchema } }, description: 'Pay rows the caller is allowed to see' },
    },
    operationId: 'listInspectionPaySplits',
    description: 'Returns what each inspector is owed on the active billing lines of one inspection. A caller with the financial capability receives every row and may edit them; a caller without it receives only their own rows, read-only, and a colleague\'s amount is absent from the payload rather than hidden in it.',
}, { scopes: ['read'], tier: 'extended' }));

const previewRefreshRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/pay-splits/refresh-preview',
    tags: ['inspections'],
    summary: 'Preview what refreshing pay would change',
    middleware: [requireRole('owner', 'manager'), requireCapability('financial')] as const,
    request: { params: IdParam },
    responses: {
        200: { content: { 'application/json': { schema: RefreshPreviewResponseSchema } }, description: 'The moves a refresh would make' },
    },
    operationId: 'previewInspectionPaySplitRefresh',
    description: 'Shows which pay rows the current tenant rules and roster would move, and to what, WITHOUT moving them. Re-deriving amounts silently is how somebody\'s pay changes with nobody deciding it should, so the preview exists to make the decision explicit before the write.',
}, { scopes: ['read'], tier: 'extended', capability: 'financial' }));

const setPaySplitRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/{id}/pay-splits/{splitId}',
    tags: ['inspections'],
    summary: 'Set an agreed pay amount by hand',
    middleware: [requireRole('owner', 'manager'), requireCapability('financial')] as const,
    request: {
        params: SplitParam,
        body: { content: { 'application/json': { schema: SetPaySplitSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: PaySplitResponseSchema } }, description: 'Pay row updated and marked manual' },
        400: { description: 'The amount would push this line past its effective price' },
        404: { description: 'No such pay row on this inspection' },
        409: { description: 'The row is locked by a payroll export; record a correction instead' },
    },
    operationId: 'setInspectionPaySplit',
    description: 'Overrides the pay owed to one inspector on one billing line and marks the row manual, which exempts it from any later refresh. Refuses once a payroll export has locked the row, because editing money that has already moved desynchronises the books with nothing surfacing the divergence.',
}, { scopes: ['write'], tier: 'extended', capability: 'financial' }));

const refreshPaySplitsRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/pay-splits/refresh',
    tags: ['inspections'],
    summary: 'Re-derive rule-sourced pay for this inspection',
    middleware: [requireRole('owner', 'manager'), requireCapability('financial')] as const,
    request: { params: IdParam },
    responses: {
        200: { content: { 'application/json': { schema: RefreshResultResponseSchema } }, description: 'Rule-sourced rows re-derived' },
        409: { description: 'A payroll export has locked splits here; record a correction instead' },
    },
    operationId: 'refreshInspectionPaySplits',
    description: 'Re-derives the rule-sourced pay rows from the tenant rules and roster as they stand now, leaving hand-edited and corrected rows alone. This is the only path that moves an amount that already exists, and it is deliberately an explicit act rather than something a read performs.',
}, { scopes: ['write'], tier: 'extended', capability: 'financial' }));

const correctPaySplitRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/pay-splits/{splitId}/corrections',
    tags: ['inspections'],
    summary: 'Record a correction against exported pay',
    middleware: [requireRole('owner', 'manager'), requireCapability('financial')] as const,
    request: {
        params: SplitParam,
        body: { content: { 'application/json': { schema: CorrectPaySplitSchema } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: PaySplitResponseSchema } }, description: 'Correction row written' },
        400: { description: 'The original is not exported yet, or is itself a correction' },
        404: { description: 'No such pay row on this inspection' },
    },
    operationId: 'correctInspectionPaySplit',
    description: 'Adjusts an already-exported pay row by writing a NEW row carrying the delta, leaving the original untouched so both what was paid and what was owed stay answerable. An in-place edit after payroll has run destroys that, which is why this is a separate verb.',
}, { scopes: ['write'], tier: 'extended', capability: 'financial' }));

const paySplitRoutes = createApiRouter()
    .openapi(listPaySplitsRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const caps = await capabilitiesFor(c);
        const rows = await getSplitsForInspection(getDrizzle(c), tenantId, id);
        const self = c.get('user')?.sub ?? '';
        const visible = caps.financial ? rows : rows.filter(s => s.userId === self);
        return c.json({
            success: true,
            data: {
                canEdit: caps.financial,
                scope: caps.financial ? ('all' as const) : ('self' as const),
                splits: visible.map(toWire),
            },
        });
    })
    .openapi(previewRefreshRoute, async (c) => {
        const { id } = c.req.valid('param');
        const changes = await previewRefresh(getDrizzle(c), getTenantId(c), id);
        return c.json({ success: true, data: { changes } });
    })
    .openapi(setPaySplitRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, splitId } = c.req.valid('param');
        const { amountCents, reason } = c.req.valid('json');
        const db = getDrizzle(c);
        await requireOnInspection(db, tenantId, id, splitId);
        const row = await setSplitManually(db, tenantId, splitId, amountCents, reason);
        return c.json({ success: true, data: toWire(row) });
    })
    .openapi(refreshPaySplitsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const changed = await refreshSplits(getDrizzle(c), getTenantId(c), id);
        return c.json({ success: true, data: { changed } });
    })
    .openapi(correctPaySplitRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, splitId } = c.req.valid('param');
        const input = c.req.valid('json');
        const db = getDrizzle(c);
        await requireOnInspection(db, tenantId, id, splitId);
        const row = await correctSplit(db, tenantId, splitId, input);
        return c.json({ success: true, data: toWire(row) }, 201);
    });

export default paySplitRoutes;
