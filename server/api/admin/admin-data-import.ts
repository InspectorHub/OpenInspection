// Admin → data import & one-time migration sub-router.
//
// Three routes, one subject: what can happen to an import run somebody sent us
// to convert. Delivery of the converted bundle (POST /import), acknowledging
// that a person has picked the file up (POST /import/acknowledge), and handing
// it back unconverted (POST /import/decline).
//
// The one-time legacy finding-key migration moved to `admin-finding-keys.ts`
// when this file crossed the size gate — it shared nothing with these but a
// prefix. Route definitions are co-located with their `.openapi()` handlers.
// Mounted at `/` by the admin aggregator.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { createApiRouter } from '../../lib/openapi-router';
import { eq, and } from 'drizzle-orm';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { ImportResponseSchema } from '../../lib/validations/admin.schema';
import {
    AcknowledgeImportRequestSchema,
    AcknowledgedImportResponseSchema,
    DeclineImportRequestSchema,
    DeclinedImportResponseSchema,
} from '../../lib/validations/admin/compliance';
import { migrationBatches } from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../../lib/status/migration-batch-status';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { getDrizzle } from '../../lib/route-helpers';
import { MigrationStageService } from '../../services/migration-intake/stage.service';
import { MigrationAssistanceService } from '../../services/migration-intake/assistance.service';
import { assertStaffAccessAuthorized } from '../../services/migration-intake/staff-access';
import { limitsFor } from '../../lib/migration-intake/limits';

/**
 * POST /api/admin/import
 *
 * Delivers a converted file into the import run it was uploaded to.
 *
 * It takes a bundle in the one normalised format rather than our own row
 * shapes, which is what makes the format's rules apply to it: no primary keys
 * of ours (ids are minted on write), counts that must equal what is actually
 * carried, and every entry the conversion could not use named rather than
 * counted. Nothing here reaches a real table — the run lands staged and the
 * workspace applies it themselves, seeing what will happen first.
 */
const importDataRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/import',
    tags: ['admin'],
    summary: 'Deliver a converted import bundle',
    description: 'Delivers a converted file, in the normalised import format, into the waiting import run it belongs to. The run becomes a prepared import the workspace reviews and applies; this route writes nothing to a real table.',
    middleware: [requireRole('owner', 'manager'), requireCapability('templateCreate')],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        batchId: z.string().min(1).describe('Id of the waiting import run this bundle was converted for'),
                        bundle: z.record(z.string(), z.unknown()).describe('The converted file in the normalised import format, validated on arrival'),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ImportResponseSchema.describe('Counts of what the run now carries') } },
            description: 'Bundle delivered',
        },
        400: { description: 'The bundle carries nothing to import, more entries than one run may carry, or a kind this run did not ask for' },
        403: { description: "Missing the 'templateCreate' capability" },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'That run is not waiting for a converted file' },
        422: { description: 'The bundle is not in the normalised import format' },
    },
    operationId: 'importTenant',
}, { scopes: ['admin'], tier: 'extended', capability: 'templateCreate' }));


/**
 * POST /api/admin/import/decline
 *
 * Hands a waiting run back, unconverted, with the reason on the run.
 *
 * "Ten working days to deliver or hand back" is half a promise until handing
 * back is something somebody can press. A run left alone reaches `expired`,
 * which says the clock ran out; `abandoned` says the operator stopped. Neither
 * is true of a file a person read and could not convert, and a trail that
 * recorded it as either would name the wrong responsible party.
 */
const declineImportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/import/decline',
    tags: ['admin'],
    summary: 'Hand a waiting import back unconverted',
    description: 'Records that a waiting import run was looked at and could not be converted, stores the reason on the run, and emails the workspace. Distinct from expiry and from abandonment: this says we stopped, having looked.',
    middleware: [requireRole('owner', 'manager'), requireCapability('templateCreate')] as const,
    request: {
        body: { content: { 'application/json': { schema: DeclineImportRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: DeclinedImportResponseSchema.describe('The run and the state it now carries') } },
            description: 'Import handed back',
        },
        400: { description: 'No reason was given, or it is too short to act on' },
        403: { description: "Missing the 'templateCreate' capability" },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'That run is not waiting for a converted file' },
    },
    operationId: 'declineTenantImport',
}, { scopes: ['admin'], tier: 'extended', capability: 'templateCreate' }));

/**
 * POST /api/admin/import/acknowledge
 *
 * Says, to the person waiting, that their file has been picked up.
 *
 * The runbook's two-working-day acknowledgement is a deadline, and a deadline
 * with no action behind it can only be kept by somebody remembering. With one,
 * "nothing has happened yet" stops looking like "somebody is on it".
 */
const acknowledgeImportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/import/acknowledge',
    tags: ['admin'],
    summary: 'Acknowledge a waiting import run',
    description: 'Records that a waiting import run has been picked up and emails the workspace to say so. It does not move the run: acknowledging a file is not converting it.',
    middleware: [requireRole('owner', 'manager'), requireCapability('templateCreate')] as const,
    request: {
        body: { content: { 'application/json': { schema: AcknowledgeImportRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AcknowledgedImportResponseSchema.describe('The run and how many people were emailed') } },
            description: 'Import acknowledged',
        },
        403: { description: "Missing the 'templateCreate' capability, or the run carries no staff-access authorisation" },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'That run is not waiting for a converted file' },
    },
    operationId: 'acknowledgeTenantImport',
}, { scopes: ['admin'], tier: 'extended', capability: 'templateCreate' }));





/**
 * Loads a run this workspace owns, for the three routes that act on one.
 *
 * The 404 comes first and is the same sentence for a run that does not exist
 * and one belonging to somebody else: telling those apart would confirm that an
 * id is real to a workspace with no business knowing it.
 *
 * `requireWaiting` is asked for by the two routes that are ANSWERS to a waiting
 * run — acknowledging it and handing it back. The delivery route leaves it to
 * `stageIntoBatch`, which re-reads the row and refuses inside the same call
 * that writes: a status checked here and acted on there is a status that was
 * true a moment ago.
 */
async function loadOwnBatch(
    c: Context<HonoConfig>,
    batchId: string,
    tenantId: string,
    opts: { requireWaiting: boolean },
) {
    const db = getDrizzle(c);
    const batch = await db.select().from(migrationBatches)
        .where(and(eq(migrationBatches.id, batchId), eq(migrationBatches.tenantId, tenantId)))
        .get();
    if (!batch) throw Errors.NotFound('Migration batch not found');
    if (opts.requireWaiting && batch.status !== MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE) {
        throw Errors.Conflict('This import is not waiting for a converted file.');
    }
    return { db, batch };
}


const adminDataImportRoutes = createApiRouter()
    .openapi(importDataRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { batchId, bundle } = c.req.valid('json');

        // Before anything is parsed: a run nobody authorised a person to read
        // does not receive what a person produced from reading it. Reading the
        // file happens in object storage, where no code of ours is watching —
        // so what this buys is that breaking the rule leaves a FAILURE rather
        // than passing silently.
        const { batch } = await loadOwnBatch(c, batchId, tenantId, { requireWaiting: false });
        assertStaffAccessAuthorized(batch);

        const stage = new MigrationStageService(c.env.DB);
        const result = await stage.stageIntoBatch({
            tenantId,
            batchId,
            bundle,
            limits: limitsFor(c.var.profile),
        });

        const byEntity = { template: 0, contact: 0, member: 0 };
        for (const row of result.rows) byEntity[row.entity]++;

        await new MigrationAssistanceService(c.env)
            .notifyDelivered(c.var.services.email, tenantId, batchId);

        // A converted file landing on a run that has been waiting for one. This
        // is the only event on the pipeline that is OURS rather than the
        // operator's, which is why it has a name of its own rather than sharing
        // `data.import` with starter-content installs.
        auditFromContext(c, 'migration.delivered', 'migration_batch', {
            entityId: batchId,
            metadata: { rows: result.rows.length, byEntity },
        });

        return c.json({
            success: true as const,
            data: { batchId, rows: result.rows.length, byEntity },
        }, 200);
    })
    .openapi(declineImportRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { batchId, reason } = c.req.valid('json');

        await new MigrationStageService(c.env.DB).declineBatch({ tenantId, batchId, reason });

        // The reason is on the run, not in the audit metadata: metadata is
        // redacted on the way in, and a redacted reason is not a reason.
        auditFromContext(c, 'migration.declined', 'migration_batch', { entityId: batchId });

        await new MigrationAssistanceService(c.env)
            .notifyDeclined(c.var.services.email, tenantId, batchId, reason);

        return c.json({
            success: true as const,
            data: { batchId, status: MIGRATION_BATCH_STATUS.DECLINED },
        }, 200);
    })
    .openapi(acknowledgeImportRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { batchId } = c.req.valid('json');

        const { db, batch } = await loadOwnBatch(c, batchId, tenantId, { requireWaiting: true });
        // The same precondition the delivery route applies, for the same
        // reason: acknowledging a run is the moment a person says they have
        // picked the file up.
        assertStaffAccessAuthorized(batch);

        const manifest = JSON.parse(batch.manifest) as Record<string, unknown>;
        manifest.acknowledgedAt = new Date().toISOString();
        await db.update(migrationBatches)
            .set({ manifest: JSON.stringify(manifest) })
            .where(and(eq(migrationBatches.id, batchId), eq(migrationBatches.tenantId, tenantId)));

        const notified = await new MigrationAssistanceService(c.env)
            .notifyReceived(c.var.services.email, tenantId, batchId);

        return c.json({ success: true as const, data: { batchId, notified } }, 200);
    });

export default adminDataImportRoutes;
