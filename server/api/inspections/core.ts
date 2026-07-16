// Core inspection CRUD + create/clone/wizard + offline-full + presence sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
//
// The per-inspection results/editing routes (property facts, results, rating
// system, recommendations, item-field patch, preflight) live alongside in
// ./results.ts to keep both files under the size ceiling.
import type { Context } from 'hono';
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { getCookie } from 'hono/cookie';
import { verifyObserverCookie } from '../../lib/observer-cookie';
import { OBSERVER_COOKIE_NAME } from '../../lib/middleware/observer-cookie';
import { canAccessInspectionCollab } from '../../lib/collab/can-access';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { InspectionSchema, CreateInspectionSchema, UpdateInspectionSchema } from '../../lib/validations/inspection.schema';
import { CreateInspectionFromWizardSchema } from '../../lib/validations/wizard.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, inspectionResults } from '../../lib/db/schema';
import { deleteInspectionCascade } from '../../services/inspection/inspection-cascade';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { eq, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import type { HonoConfig } from '../../types/hono';
import { logger } from '../../lib/logger';
import { MeteringService } from '../../services/metering.service';
import { readTenantTier } from '../../features/plan-quota/guard';
import { noticeFor } from '../../features/plan-quota/notice';
import { loadTenantEmailConfig, assembleTenantEmailService } from '../../lib/email/build-email-service';
import { resolveInternalHolidayEffect } from '../../lib/holidays/load-tenant-holidays';

/**
 * Free-tier usage quotas (2026-07), Task 8 — after a successful inspection
 * create/clone/wizard call, check whether the tenant's lifetime inspection
 * counter just crossed the 4/5 or 5/5 notice threshold and, if so, fire a
 * best-effort email. Gated on `hasUsageQuota` (SaaS only — standalone has no
 * DB reads added here beyond the one profile-flag check) and on the tenant's
 * plan tier ('free' only). The email itself is unmetered (see
 * `sendQuotaThresholdNotice` — no `meterTenantId` is passed to
 * `assembleTenantEmailService`) so it can never itself consume or be blocked
 * by the tenant's free-tier email quota.
 */
async function maybeSendQuotaThresholdNotice(c: Context<HonoConfig>, tenantId: string): Promise<void> {
    if (!c.var.profile.hasUsageQuota) return;
    const tier = await readTenantTier(c.env.DB, tenantId);
    if (tier !== 'free') return;

    const count = await new MeteringService(c.env.DB).lifetimeTotal(tenantId, 'inspections');
    const n = noticeFor(count);
    if (!n) return;

    const cfg = await loadTenantEmailConfig(c.env, tenantId);
    const email = assembleTenantEmailService(c.env, cfg);
    await email.sendQuotaThresholdNotice(n, {
        db: c.env.DB,
        kv: c.env.TENANT_CACHE,
        tenantId,
        billingPortalUrl: c.var.profile.billingPortalUrl,
    });
}

/**
 * Fire-and-forget wrapper: runs `maybeSendQuotaThresholdNotice` through
 * `c.executionCtx.waitUntil` so it adds zero latency to the response, and
 * never lets a failure (email provider down, KV unavailable, ...) surface as
 * an unhandled rejection. `c.executionCtx` throws when no execution context
 * is present (some unit-test harnesses) — degrade to a no-op there, mirroring
 * the guard in server/api/sms.ts.
 */
function fireQuotaThresholdNotice(c: Context<HonoConfig>, tenantId: string): void {
    const run = maybeSendQuotaThresholdNotice(c, tenantId).catch((err) => {
        logger.error('quota threshold notice failed', { tenantId }, err instanceof Error ? err : new Error(String(err)));
    });
    try { c.executionCtx.waitUntil(run); } catch { /* no execution context available (unit tests) */ }
}

/**
 * GET /api/inspections/:id
 */
export const getInspectionRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Get inspection for current tenant",
    description: 'Retrieve detailed information about a single inspection.',
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema.describe('TODO describe inspection field for the OpenInspection MCP integration'),
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
export const deleteInspectionRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Delete inspection for current tenant",
    description: "Permanently remove an inspection record. (DELETE /{id}, inspections domain).",
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
    operationId: "deleteInspection"
}, { scopes: ['write'], tier: 'primary' }));

/**
 * PATCH /api/inspections/:id
 */
export const updateInspectionRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Patch inspection for current tenant",
    description: "Partially update an inspection record. (PATCH /{id}, inspections domain).",
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: UpdateInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
        400: { description: 'coverPhotoId does not reference a photo of this inspection (DB-16)' },
    },
    operationId: "patchInspection"
}, { scopes: ['write'], tier: 'primary' }));

/**
 * POST /api/inspections
 */
export const createInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/',
    tags: ["inspections"],
    summary: "Create inspection for current tenant",
    description: "Initialize a new inspection for a property. (POST /, inspections domain).",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CreateInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema.describe('TODO describe inspection field for the OpenInspection MCP integration'),
                    })),
                },
            },
            description: 'Created',
        },
    },
    operationId: "createInspection"
}, { scopes: ['write'], tier: 'primary' }));

/**
 * POST /api/inspections/:id/clone
 */
export const cloneInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/clone',
    tags: ["inspections"],
    summary: "Clone inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ inspection: InspectionSchema.describe('TODO describe inspection field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Created',
        },
    },
    operationId: "cloneInspection",
    description: "Auto-generated placeholder for cloneInspection (POST /{id}/clone, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem B phase 5 task 5.3 — NewInspectionWizard create.
// -----------------------------------------------------------------------------
// Sibling endpoint to POST /api/inspections (the legacy single-step create).
// 4-step wizard payload validated by CreateInspectionFromWizardSchema.
// Returns the new inspection id so the wizard factory redirects to
// /inspections/:id/edit on success.
export const createFromWizardRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/wizard',
    tags: ["inspections"],
    summary:    'Create an inspection from the 4-step NewInspectionWizard',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: { content: { 'application/json': { schema: CreateInspectionFromWizardSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            description: 'Created',
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                data:    z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
        },
        400: { description: 'Validation error' },
    },
    operationId: "createInspectionWizard",
    description: "Auto-generated placeholder for createInspectionWizard (POST /wizard, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


const coreRoutes = createApiRouter()
    .openapi(getInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const result = await service.getInspection(id, c.get('tenantId'));
        return c.json({
            success: true,
            data: result
        }, 200);
    })
    .openapi(deleteInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        // Cascade-delete every inspection-scoped row + R2 asset (D1 does not honor
        // FK cascades at runtime). Ownership verified by getInspection above.
        await deleteInspectionCascade(drizzle(c.env.DB), c.env.PHOTOS, tenantId, id);

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
        const db = drizzle(c.env.DB);

        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);

        // DB-16 — coverPhotoId holds the R2 key of a photo belonging to THIS
        // inspection (an attached item photo or a loose pool photo); null clears
        // the cover. Reject foreign/dangling keys so the preflight gate + report
        // renderer can always resolve the image.
        if (typeof body.coverPhotoId === 'string') {
            const ok = await c.var.services.inspection.isInspectionPhotoKey(id, tenantId, body.coverPhotoId);
            if (!ok) {
                return c.json({ success: false as const, error: { code: 'INVALID_COVER_PHOTO', message: 'coverPhotoId does not reference a photo of this inspection' } }, 400);
            }
        }

        // Tenant-ownership pre-check above guards access. The validated `body`
        // can legitimately be empty: the settings sheet forwards its whole form
        // and the BFF sanitizer drops empty-string "unchanged" fields, so a save
        // that touched nothing (or only fields outside UpdateInspectionSchema)
        // arrives as `{}`. drizzle throws "No values to set" on `.set({})`, which
        // used to surface as a 500 → the sheet's "Error — try again". Treat the
        // no-op as a successful save instead of writing an empty UPDATE.
        if (Object.keys(body).length > 0) {
            await db.update(inspectionTable).set(body).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));
        }

        // DB-8: re-sync link table when inspectorId is explicitly updated.
        // DB-8: mirror ALL canonical assignment columns — PATCH can only change
        // inspectorId, so preserve the pre-patch team-mode fields (leadInspectorId,
        // helperInspectorIds) from the fetched row so the link table stays a faithful
        // mirror of post-patch canonical state and team-mode rows are not wiped.
        if ('inspectorId' in body) {
            let helpers: string[] = [];
            try { helpers = JSON.parse(inspection.helperInspectorIds ?? '[]'); } catch { /* malformed legacy JSON -> no helpers */ }
            await syncInspectionAssignments(db, tenantId, id, {
                inspectorId:        body.inspectorId ?? null,
                leadInspectorId:    inspection.leadInspectorId,
                helperInspectorIds: helpers,
            });
        }

        if (body.status && body.status !== inspection.status) {
            auditFromContext(c, 'inspection.status_change', 'inspection', {
                entityId: id,
                metadata: { from: inspection.status, to: body.status },
            });
        }
        return c.json({ success: true }, 200);
    })
    .openapi(createInspectionRoute, async (c) => {
        const body = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const contactService = c.var.services.contact;

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

        // Filter undefined values and handle inspectorId logic
        const createData = Object.fromEntries(
            Object.entries(body).filter(([_, v]) => v !== undefined)
        ) as typeof body;

        // IA-1: Resolve client contact before creating the inspection.
        let clientContactId: string | undefined;
        if (body.client) {
            const { id } = await contactService.upsertClientContact(tenantId, {
                name:  body.client.name,
                email: body.client.email,
                phone: body.client.phone,
                type:  'client',
            });
            clientContactId = id;
            // Double-write denormalized columns so legacy read paths keep working.
            // Unconditional: the structured client object is the authoritative
            // source — the flat clientName carries a zod default ('Private
            // Client') that would otherwise always win and mask the real name.
            (createData as Record<string, unknown>).clientName = body.client.name;
            (createData as Record<string, unknown>).clientEmail = body.client.email ?? null;
            (createData as Record<string, unknown>).clientPhone = body.client.phone ?? null;
        }

        // IA-1: Resolve agent — newAgent creates/finds a contacts row; agentContactId uses an existing one.
        let resolvedAgentId: string | undefined = createData.referredByAgentId as string | undefined;
        if (body.newAgent) {
            const { id } = await contactService.upsertClientContact(tenantId, {
                name:  body.newAgent.name,
                email: body.newAgent.email,
                type:  'agent',
            });
            resolvedAgentId = id;
        } else if (body.agentContactId) {
            resolvedAgentId = body.agentContactId;
        }

        const inspection = await service.createInspection(tenantId, {
            ...createData,
            inspectorId:       body.inspectorId || c.get('user').sub,
            referredByAgentId: resolvedAgentId ?? null,
            // IA-1: pass the resolved contact ids through; createInspection stores them.
            clientContactId,
        } as Parameters<typeof service.createInspection>[1]);

        // IA-1: Apply serviceSelections price overrides — replace null priceOverride
        // for any service whose id appears in serviceSelections with a set override.
        if (body.serviceSelections && body.serviceSelections.length > 0) {
            await service.applyServicePriceOverrides(inspection.id, tenantId, body.serviceSelections);
        }

        auditFromContext(c, 'inspection.create', 'inspection', {
            entityId: inspection.id,
            metadata: { propertyAddress: inspection.propertyAddress },
        });
        fireQuotaThresholdNotice(c, tenantId);

        return c.json({
            success: true,
            data: { inspection }
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
        return c.json({ success: true, data: { inspection: clone } }, 201);
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
    // Typed-Hono dead-routes cleanup Task 12 — list persisted sync conflicts.
    .get('/:id/full', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const id       = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const svc      = c.var.services.inspection;
        try {
            const { inspection, template } = await svc.getInspection(id, tenantId);
            const db = drizzle(c.env.DB);
            const results = await db.select().from(inspectionResults)
                .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
            return c.json({ success: true, data: { inspection, template: template || null, results: results || null, base: null } });
        } catch (err) {
            if (err instanceof Error && err.message.includes('not found')) {
                return c.json({ success: false, error: { code: 'not_found', message: 'Inspection not found' } }, 404);
            }
            throw err;
        }
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

        // Design System 0520 subsystem D phase 6 — observer fallback.
        // Inspector path uses JWT; observers carry the dedicated
        // __Host-observer_session cookie. We try JWT first (the common
        // case) then degrade to the observer cookie. Both produce a DO
        // attach request with `x-user-role: inspector` or `observer`
        // respectively — the DO already routes the two roles correctly
        // (observers are read-only in the roster snapshot).
        let attachUserId: string;
        let attachName:   string;
        let attachRole:   'inspector' | 'observer';

        if (userId && tenantId) {
            let ins;
            try {
                const out = await c.var.services.inspection.getInspection(id, tenantId);
                ins = out.inspection;
            } catch {
                return new Response('not found', { status: 404 });
            }

            const userRole = c.get('userRole') as string | undefined;
            const allowed = canAccessInspectionCollab(ins, { id: userId, role: userRole ?? '' });
            if (!allowed) return new Response('forbidden', { status: 403 });

            attachUserId = userId;
            attachName   = ins.inspectorId === userId ? 'Inspector' : 'Helper';
            attachRole   = 'inspector';
        } else {
            const cookie = getCookie(c, OBSERVER_COOKIE_NAME);
            if (!cookie) return new Response('unauthorized', { status: 401 });
            const payload = await verifyObserverCookie(cookie, c.env.JWT_SECRET);
            if (!payload || payload.inspectionId !== id) {
                return new Response('forbidden', { status: 403 });
            }
            attachUserId = `observer-${payload.linkId}`;
            attachName   = 'Observer';
            attachRole   = 'observer';
        }

        const doId = c.env.INSPECTION_PRESENCE.idFromName(id);
        const stub = c.env.INSPECTION_PRESENCE.get(doId);

        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':          'websocket',
                'x-user-id':        attachUserId,
                'x-user-name':      attachName,
                'x-user-photo-url': '',
                'x-user-role':      attachRole,
            },
        });
        return stub.fetch(fwd);
    });

export default coreRoutes;
