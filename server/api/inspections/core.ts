// Core inspection CRUD + create/clone/wizard + offline-full + presence sub-router.
// Extracted from inspections.ts; handler bodies + route definitions are unchanged.
//
// The per-inspection results/editing routes (property facts, results, rating
// system, recommendations, item-field patch, preflight) live alongside in
// ./results.ts to keep both files under the size ceiling.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { guardPatchReschedule, guardInspectionDelete } from './core-access';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { canAccessInspectionCollab } from '../../lib/collab/can-access';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { InspectionSchema, UpdateInspectionSchema, PatchInspectionResponseSchema } from '../../lib/validations/inspection.schema';
import { CreateInspectionFromWizardSchema } from '../../lib/validations/wizard.schema';
import { inspections as inspectionTable } from '../../lib/db/schema';
import { datePatchValues } from '../../services/inspection/reschedule-date';
import { pushInspectionAfterResponse } from '../../lib/calendar/push-hooks';
import { findPatchRefusal } from './patch-guards';
import { deleteInspectionCascade } from '../../services/inspection/inspection-cascade';
import { syncAssignmentsAndSplits } from '../../services/pay-split.service';
import { eq, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { resolveInternalHolidayEffect } from '../../lib/holidays/load-tenant-holidays';
import { getDrizzle } from '../../lib/route-helpers';
import { patchRevisionReport } from './patch-revision-report';
import { createInspectionRoute } from './core-create-route';
import { completeReplayedCreate } from './create-replay';
import { moneyView, assertMoneyWriteAllowed } from '../../lib/auth/money-access';
import { capabilitiesFor } from '../../lib/middleware/require-capability';
import { fireQuotaThresholdNotice, recordCreateAudit, resolveCreateInput } from './create-support';

/**
 * GET /api/inspections/:id
 */
const getInspectionRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Get inspection for current tenant",
    description: 'Retrieve detailed information about a single inspection.',
    request: {
        params: z.object({
            id: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('Inspection id.'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema.describe('The inspection record.'),
                        template: z.unknown().openapi({ description: 'The associated template schema' }),
                    })),
                },
            },
            description: 'Success',
        },
        404: {
            description: 'Inspection not found',
        },
    },
    operationId: "getInspection"
}, { scopes: ['read'], tier: 'primary' }));

/**
 * DELETE /api/inspections/:id
 */
const deleteInspectionRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Delete inspection for current tenant",
    description: "Permanently remove an inspection record. Owner and manager can delete any inspection; an inspector only one they lead, unless granted the scheduleOthers capability; helpers and other inspectors get 403.",
    request: {
        params: z.object({
            id: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('Inspection id.'),
        }),
    },
    middleware: [requireRole('owner', 'manager', 'inspector'), guardInspectionDelete],
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
    operationId: "deleteInspection"
}, { scopes: ['write'], tier: 'primary' }));

/**
 * PATCH /api/inspections/:id
 */
const updateInspectionRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Patch inspection for current tenant",
    description: "Partially update an inspection record. Available to owner, manager and inspector roles; changing the assigned inspector requires the scheduleOthers capability (owner and manager have it by default), and so does changing the date of an inspection the caller is not on (lead or helper); an inspector on the inspection can change its date, and may edit other fields.",
    request: {
        params: z.object({
            id: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('Inspection id.'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: UpdateInspectionSchema,
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector'), guardPatchReschedule],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: PatchInspectionResponseSchema,
                },
            },
            description: 'Success',
        },
        400: { description: 'A refused patch: a dangling soft reference (DB-16); status:cancelled, which only POST /{id}/cancel may write (#78); or any status change on an already-cancelled inspection, which only POST /{id}/uncancel may make (#81)' },
    },
    operationId: "patchInspection"
}, { scopes: ['write'], tier: 'primary' }));

/**
 * POST /api/inspections/:id/clone
 */
const cloneInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/clone',
    tags: ["inspections"],
    summary: "Clone inspection for current tenant",
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Id of the inspection to copy.') }),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ inspection: InspectionSchema })),
                },
            },
            description: 'Created',
        },
    },
    operationId: "cloneInspection",
    description: "Creates a new inspection as a copy of an existing one. The copy gets a new id, today's date and time, status draft and payment status unpaid; every other column of the source record is carried over as stored, and the source's client and agent links and its lead and helper assignments are copied onto it. Findings, photos and reports are not copied by this route. Counts as one new inspection against the company's plan quota, and a quota-threshold notice may be sent when the limit is approached. Records an inspection.create audit entry noting the source id. Not idempotent: each call makes another copy. Responds 404 if the source is missing. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem B phase 5 task 5.3 — NewInspectionWizard create.
// -----------------------------------------------------------------------------
// Sibling endpoint to POST /api/inspections (the legacy single-step create).
// 4-step wizard payload validated by CreateInspectionFromWizardSchema.
// Returns the new inspection id so the wizard factory redirects to
// /inspections/:id/edit on success.
const createFromWizardRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/wizard',
    tags: ["inspections"],
    summary:    'Create an inspection from the 4-step NewInspectionWizard',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: { content: { 'application/json': { schema: CreateInspectionFromWizardSchema.describe('The wizard answers: property facts, requested services, schedule and team assignment.') } } },
    },
    responses: {
        200: {
            description: 'Created',
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data:    z.object({ id: z.string() }),
            }) } },
        },
        400: { description: 'Validation error' },
    },
    operationId: "createInspectionWizard",
    description: "Creates an inspection from the new-inspection wizard payload (property, services, schedule and team) and returns the new inspection id. The signed-in user becomes the inspector and the scheduled date and start time are combined into the inspection date. The client is not collected here: the inspection is created with the placeholder client name Private Client and no contact details, so attach a client afterwards. The services list is validated but this route does not use it to create anything. Property type and commercial subtype (only honoured for commercial) are applied after creation. When team mode is on, the lead defaults to the signed-in user and the helpers are assigned; when it is off, any lead or helpers sent are ignored and the creator is the sole assignee. Counts against the company's plan quota. Unlike the plain create route it responds 200, not 201. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));


const coreRoutes = createApiRouter()
    .openapi(getInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const result = await service.getInspection(id, c.get('tenantId'));
        return c.json({
            success: true,
            // Only the inspection row is projected: `template` is customer-authored
            // schema JSON and may legitimately contain a field called `price`.
            data: { ...result, inspection: await moneyView(c, result.inspection) },
        }, 200);
    })
    .openapi(deleteInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        // Cascade-delete every inspection-scoped row + R2 asset (D1 does not honor
        // FK cascades at runtime). Ownership verified by getInspection above.
        await deleteInspectionCascade(getDrizzle(c), c.env.PHOTOS, tenantId, id);

        auditFromContext(c, 'inspection.delete', 'inspection', {
            entityId: id,
            metadata: { propertyAddress: inspection.propertyAddress },
        });
        return c.json({ success: true }, 200);
    })
    .openapi(updateInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = getDrizzle(c);

        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);

        // Money fields need `financial`, but only a CHANGE is refused: the settings
        // form forwards its whole form, price included. Before anything else runs.
        assertMoneyWriteAllowed(await capabilitiesFor(c), body, inspection as Record<string, unknown>);

        // Every soft reference this patch can dangle, plus the two status moves
        // it may not make: INTO `cancelled` (#78) and OUT of it (#81). Both live
        // behind their own endpoint. Refused before anything is. ./patch-guards.
        const refusal = await findPatchRefusal(
            db, tenantId, id, body,
            (i, t, key) => c.var.services.inspection.isInspectionPhotoKey(i, t, key),
            inspection.status,
        );
        if (refusal) return c.json({ success: false as const, error: refusal }, 400);

        // A date PATCH moves the scheduled instant with the civil day
        // (§7.5 item 3) — see services/inspection/reschedule-date.ts.
        const updateValues: Record<string, unknown> = typeof body.date === 'string'
            ? await datePatchValues(db, tenantId, id, body as Record<string, unknown> & { date: string })
            : { ...body };

        // Deposit tier 3. The FLAG is the whole point: `deposit_required_cents`
        // alone cannot tell a computed snapshot from a figure an operator
        // agreed on the phone, so a later re-resolve would silently overwrite
        // the second. Clearing the amount clears the override with it —
        // otherwise the order stays pinned to a number that no longer exists.
        if ('depositRequiredCents' in body) updateValues.depositOverridden = body.depositRequiredCents != null;

        // Tenant-ownership pre-check above guards access. The validated `body`
        // can legitimately be empty: the settings sheet forwards its whole form
        // and the BFF sanitizer drops empty-string "unchanged" fields, so a save
        // that touched nothing (or only fields outside UpdateInspectionSchema)
        // arrives as `{}`. drizzle throws "No values to set" on `.set({})`, which
        // used to surface as a 500 → the sheet's "Error — try again". Treat the
        // no-op as a successful save instead of writing an empty UPDATE.
        if (Object.keys(updateValues).length > 0) {
            await db.update(inspectionTable).set(updateValues).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));
        }

        // DB-8: re-sync the link table when inspectorId is explicitly updated.
        // The pre-patch lead/helper columns used to be read back and re-supplied
        // here to avoid wiping "team mode" rows. They are frozen dead and were
        // NULL / '[]' on every row, so there was never anything to preserve.
        if ('inspectorId' in body) {
            await syncAssignmentsAndSplits(db, tenantId, id, {
                inspectorId: body.inspectorId ?? null,
            });
        }

        // Keep the lead's own calendar in step with whatever this patch changed.
        // One call covers all three cases it can produce: a moved date UPDATEs
        // the existing entry, a new inspectorId moves it between calendars, and
        // a cancel takes it off — pushInspectionToGoogle re-reads the row and
        // decides, so the route does not have to enumerate them.
        if ('date' in body || 'inspectorId' in body || 'status' in body) {
            pushInspectionAfterResponse(c, tenantId, id);
        }

        if (body.status && body.status !== inspection.status) {
            auditFromContext(c, 'inspection.status_change', 'inspection', {
                entityId: id,
                metadata: { from: inspection.status, to: body.status },
            });
        }

        // A moved date can move which statutory revision governs this
        // inspection. ./patch-revision-report says why that is reported rather
        // than refused, and why the key is absent when there is nothing to say.
        return c.json(patchRevisionReport(body, updateValues, inspection), 200);
    })
    .openapi(createInspectionRoute, async (c) => {
        const body = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        assertMoneyWriteAllowed(await capabilitiesFor(c), body, null);

        // A replay of a create that named its own id (an offline device after the Idempotency-Key window):
        // answer with the existing inspection, finishing whatever the first attempt did not reach (./create-replay).
        if (body.id) {
            const existing = await service.findInspectionById(tenantId, body.id);
            if (existing) return c.json({ success: true, data: { inspection: await moneyView(c, await completeReplayedCreate(c, existing, body)) } }, 200);
        }

        const civilDate = String(body.date ?? '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) {
            const holiday = await resolveInternalHolidayEffect(c.env.DB, tenantId, civilDate);
            if (holiday.effect === 'block') {
                throw Errors.BadRequest(
                    holiday.name
                        ? `Cannot schedule on ${holiday.name} — company holidays are blocked.`
                        : 'Cannot schedule on a company closed day.',
                    'HOLIDAY_BLOCKED',
                );
            }
        }

        // The audit row is written inside the create, ahead of the primary report (./create-support).
        const { inspection, created } = await service.createInspectionOnce(tenantId, await resolveCreateInput(c, body), {
            beforeReport: (id) => recordCreateAudit(c, id, body.propertyAddress),
        });
        // A concurrent request with the same client id won the insert: this one is a
        // replay, so it answers like one and repeats none of the side effects below.
        if (!created) return c.json({ success: true, data: { inspection: await moneyView(c, await completeReplayedCreate(c, inspection, body)) } }, 200);

        fireQuotaThresholdNotice(c, tenantId);

        return c.json({
            success: true,
            data: { inspection: await moneyView(c, inspection) },
        }, 201);
    })
    .openapi(cloneInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const clone = await service.cloneInspection(id, tenantId);

        auditFromContext(c, 'inspection.create', 'inspection', {
            entityId: clone.id,
            metadata: { clonedFrom: id, propertyAddress: clone.propertyAddress },
        });
        fireQuotaThresholdNotice(c, tenantId);
        return c.json({ success: true, data: { inspection: await moneyView(c, clone) } }, 201);
    })
    .openapi(createFromWizardRoute, async (c) => {
        const input    = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.inspection.createFromWizard(tenantId, userId, input);
        fireQuotaThresholdNotice(c, tenantId);
        return c.json({ success: true as const, data: out }, 200);
    })
    .get('/:id/presence/ws', async (c) => {
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }
        if (!c.env.INSPECTION_PRESENCE) {
            return new Response('presence unavailable', { status: 501 });
        }

        const id = c.req.param('id');
        if (!id) return new Response('not found', { status: 404 });

        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;

        // Presence is staff-only: attaching requires a JWT identity that
        // passes the collab access check. (This branch used to fall back to a
        // no-account observer-link cookie; that capability was retired along
        // with its landing page, so there is no second identity to try.)
        if (!userId || !tenantId) return new Response('unauthorized', { status: 401 });

        // For the guard, not the row: throws when the inspection is missing or
        // belongs to another tenant. Who may edit comes from the roster below.
        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            return new Response('not found', { status: 404 });
        }

        const userRole = c.get('userRole') as string | undefined;
        const roster = await getInspectionRoster(getDrizzle(c), tenantId, id);
        if (!canAccessInspectionCollab(roster, { id: userId, role: userRole ?? '' })) {
            return new Response('forbidden', { status: 403 });
        }

        const attachUserId = userId;
        // Label from the roster too, so the presence badge cannot say "Helper"
        // about the person the roster calls the lead.
        const attachName   = roster.lead?.id === userId ? 'Inspector' : 'Helper';

        const doId = c.env.INSPECTION_PRESENCE.idFromName(id);
        const stub = c.env.INSPECTION_PRESENCE.get(doId);

        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':          'websocket',
                'x-user-id':        attachUserId,
                'x-user-name':      attachName,
                'x-user-photo-url': '',
                'x-user-role':      'inspector',
            },
        });
        return stub.fetch(fwd);
    });

export default coreRoutes;
