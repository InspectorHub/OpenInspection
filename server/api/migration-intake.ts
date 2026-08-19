import type { Context } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { getBaseUrl } from '../lib/repair-gates';
import { getDrizzle } from '../lib/route-helpers';
import { Errors } from '../lib/errors';
import { migrationBatches, migrationRows, type MigrationIntent } from '../lib/db/schema';
import { MIGRATION_BATCH_STATUS, type MigrationBatchStatus } from '../lib/status/migration-batch-status';
import type { HonoConfig } from '../types/hono';
import { assertSourceSizeWithin, limitsFor } from '../lib/migration-intake/limits';
import { buildBundle, defaultMappingFor, matchAdapter } from '../lib/migration-intake/adapters/registry';
import { STAFF_ACCESS_AUTHORIZATION_VERSION } from '../lib/migration-intake/authorizations';
import { assertConversionByPersonAvailable } from '../lib/migration-intake/unreadable-file';
import { MigrationStageService } from '../services/migration-intake/stage.service';
import { MigrationReportService } from '../services/migration-intake/report.service';
import { MigrationApplyService } from '../services/migration-intake/apply.service';
import { MigrationRevertService } from '../services/migration-intake/revert.service';
import { MigrationRepairService } from '../services/migration-intake/repair.service';
import { MigrationSourceFileService, extForFileName } from '../services/migration-intake/source-file.service';
import { expiryFor } from '../services/migration-intake/assistance.service';
import {
    abandonRoute,
    applyRoute,
    assistanceRoute,
    createBatchRoute,
    getBatchRoute,
    listBatchesRoute,
    remapRoute,
    repairRowRoute,
    revertRoute,
} from './migration-intake/route-definitions';

/**
 * Whether this actor may run THIS import.
 *
 * Per intent rather than one gate on the shared route, because a single gate is
 * wrong in one direction or the other by construction: it either hands template
 * import to somebody without the capability, or shuts out somebody who is
 * allowed to import contacts. The gates reused here are the ones the rest of
 * the product already enforces for the same actions.
 *
 * `assisted.full` is tightened to owner alone. It is a decision to put a file
 * containing third-party personal data in front of somebody outside the
 * company, which is not the same question as who may import data.
 *
 * Module-private, and it stays that way: the routes that edit an existing run
 * live in this file too, so they reach it directly. Exporting it would put a
 * second spelling of this gate within reach of somewhere that is not an import
 * route, which is how a gate and the thing it guards come apart.
 */
async function assertIntentAllowed(c: Context<HonoConfig>, intent: MigrationIntent): Promise<void> {
    if (intent === 'assisted.full') {
        if (c.get('userRole') !== 'owner') {
            throw Errors.Forbidden('Only an owner can send a file to be converted.');
        }
        return;
    }
    if (intent === 'contacts.import' || intent === 'members.invite') {
        // The role floor on the route is the whole gate here, matching the
        // existing contact-import and invite paths.
        return;
    }
    const caps = await capabilitiesFor(c);
    // BOTH, because the entry point that leads here is gated on
    // `templateImport` (the Templates page renders its import button behind it,
    // and POST /api/templates/import mounts requireCapability('templateImport'))
    // while creating a template is gated on `templateCreate`. A route reached
    // from a button must not accept somebody the button would have hidden from,
    // and must not accept somebody who could not create the thing it is about
    // to create.
    if (!caps.templateImport) throw Errors.Forbidden("Requires the 'templateImport' capability");
    if (!caps.templateCreate) throw Errors.Forbidden("Requires the 'templateCreate' capability");
    if (intent === 'templates.overwrite' && !caps.templateEdit) {
        throw Errors.Forbidden("Requires the 'templateEdit' capability");
    }
}

/**
 * Loads a run this workspace owns and re-applies its own intent's gate.
 *
 * EVERY route below does this, not only the one that created the run. The gate
 * that mattered when the file was uploaded is the same gate that matters when
 * the rows are written, and an actor's capabilities can change in between.
 *
 * The 404 comes first and is the same sentence for a run that does not exist
 * and one belonging to somebody else: telling those two apart would confirm
 * that an id is real to a workspace with no business knowing it.
 */
async function loadGatedBatch(c: Context<HonoConfig>, batchId: string) {
    const tenantId = c.get('tenantId');
    const db = getDrizzle(c);
    const batch = await db.select().from(migrationBatches)
        .where(and(eq(migrationBatches.id, batchId), eq(migrationBatches.tenantId, tenantId)))
        .get();
    if (!batch) throw Errors.NotFound('Migration batch not found');
    await assertIntentAllowed(c, batch.intent);
    return { db, batch, tenantId };
}

/** The two states a run can still be thrown away from. Anything else has written something. */
const ABANDONABLE: MigrationBatchStatus[] = [
    MIGRATION_BATCH_STATUS.STAGED,
    MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE,
];

/** The handlers. Their shapes — and why they share one prefix — live next door. */
const migrationIntakeRoutes = createApiRouter()
    .openapi(createBatchRoute, async (c) => {
        const tenantId = c.get('tenantId');
        // `userId` is not a context variable in this app; the verified JWT
        // payload is, and the subject is its `sub`.
        const userId = c.get('user').sub;
        const profile = c.var.profile;
        const limits = limitsFor(profile);

        const form = c.req.valid('form');
        const intent = form.intent;
        await assertIntentAllowed(c, intent);

        if (form.uploadAuthorized !== 'true') {
            throw Errors.BadRequest('The file can only be kept with your agreement, and this upload did not carry it.');
        }
        const staffAccessAuthorized = form.staffAccessAuthorized === 'true';

        const file = (await c.req.formData()).get('file');
        if (!(file instanceof File)) throw Errors.BadRequest('Attach the file you exported.');
        const text = await file.text();
        if (!text.trim()) throw Errors.BadRequest('That file is empty.');

        const ext = extForFileName(file.name);
        assertSourceSizeWithin(limits, ext, new TextEncoder().encode(text).length);

        const source = { fileName: file.name, text };
        const stage = new MigrationStageService(c.env.DB);
        const files = new MigrationSourceFileService(c.env.PHOTOS);
        const now = new Date();

        /**
         * The id the stored object is filed under.
         *
         * Its own id, not the run's. The run does not exist yet — the staging
         * service mints that id as it writes the row — and a batch has to carry
         * the key from its FIRST write, because a row that names no file is a
         * run nothing can resume and the sweep cannot delete by key. Nothing
         * rebuilds this key from a batch id: every reader takes it off
         * `migration_batches.source_key`, which is where the tie between the two
         * actually lives.
         */
        const sourceId = crypto.randomUUID();

        /**
         * Runs a write that the stored object only makes sense alongside, and
         * takes the object back out if it refuses.
         *
         * Leaving it for the sweep instead would retain a third party's file
         * under an authorisation given for a run that does not exist.
         */
        const withStoredFile = async <T>(write: (sourceKey: string) => Promise<T>): Promise<T> => {
            const sourceKey = await files.put(tenantId, sourceId, ext, text);
            try {
                return await write(sourceKey);
            } catch (err) {
                await files.remove([sourceKey]);
                throw err;
            }
        };

        /** Nothing here can read it: the run waits for a person, or it is refused unstored. */
        const openWaitingRun = async () => {
            assertConversionByPersonAvailable(profile, staffAccessAuthorized);
            const created = await withStoredFile((sourceKey) => stage.createAssistanceBatch({
                tenantId,
                createdBy: userId,
                intent,
                targetId: form.targetId ?? null,
                sourceKey,
                expiresAt: expiryFor(true, now),
                uploadAuthorizedBy: userId,
                staffAccessAuthorizedBy: userId,
            }));
            return c.json({
                success: true as const,
                data: {
                    batchId: created.batchId,
                    status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE,
                    needsAssistance: true,
                },
            }, 201);
        };

        // Asked before the adapters are, and not by them: this entry point
        // exists for a file nobody could classify, so letting it guess would be
        // the inference every other entry point is built to avoid.
        if (intent === 'assisted.full') return openWaitingRun();

        const match = matchAdapter(intent, source);
        if (!match) return openWaitingRun();

        const built = buildBundle(match.vendor, source, defaultMappingFor(intent, match.inspection, source));
        if (!built.ok) throw Errors.UnprocessableEntity(built.error.message);

        const staged = await withStoredFile((sourceKey) => stage.stage({
            tenantId,
            createdBy: userId,
            intent,
            targetId: form.targetId,
            bundle: built.bundle,
            limits,
            sourceKey,
            expiresAt: expiryFor(false, now),
            uploadAuthorizedBy: userId,
        }));
        return c.json({
            success: true as const,
            data: {
                batchId: staged.batchId,
                status: MIGRATION_BATCH_STATUS.STAGED,
                needsAssistance: false,
            },
        }, 201);
    })
    .openapi(listBatchesRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { limit } = c.req.valid('query');
        const db = getDrizzle(c);
        const rows = await db.select({
            id: migrationBatches.id,
            intent: migrationBatches.intent,
            vendor: migrationBatches.vendor,
            status: migrationBatches.status,
            createdAt: migrationBatches.createdAt,
            expiresAt: migrationBatches.expiresAt,
        })
            .from(migrationBatches)
            .where(eq(migrationBatches.tenantId, tenantId))
            .orderBy(desc(migrationBatches.createdAt))
            .limit(limit ?? 50)
            .all();
        return c.json({
            success: true as const,
            data: {
                items: rows.map((r) => ({
                    id: r.id,
                    intent: r.intent,
                    vendor: r.vendor,
                    status: r.status,
                    createdAt: r.createdAt.toISOString(),
                    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
                })),
            },
        }, 200);
    })
    .openapi(getBatchRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const { page, pageSize } = c.req.valid('query');
        const report = new MigrationReportService(c.env.DB);
        const data = await report.build({
            // The verified tenant, never one named in the request: this id is
            // the whole of the scoping on a report that reads staged entries.
            tenantId: c.get('tenantId'),
            batchId,
            page,
            pageSize,
            seatQuotaEnforced: c.var.profile.hasSeatQuota,
        });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(remapRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const { mapping } = c.req.valid('json');
        const { tenantId } = await loadGatedBatch(c, batchId);
        const repair = new MigrationRepairService(c.env.DB, c.env.PHOTOS);
        const data = await repair.remap({ tenantId, batchId, mapping, limits: limitsFor(c.var.profile) });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(repairRowRoute, async (c) => {
        const { batchId, rowId } = c.req.valid('param');
        const { payload } = c.req.valid('json');
        const { tenantId } = await loadGatedBatch(c, batchId);
        const repair = new MigrationRepairService(c.env.DB, c.env.PHOTOS);
        const data = await repair.repairRow({ tenantId, batchId, rowId, payload });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(applyRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const body = c.req.valid('json');
        const { tenantId } = await loadGatedBatch(c, batchId);

        const apply = new MigrationApplyService(c.env.DB);
        const result = await apply.apply({
            tenantId,
            batchId,
            conflictPolicy: body.conflictPolicy,
            rowResolutions: body.rowResolutions,
            seatQuotaEnforced: c.var.profile.hasSeatQuota,
            billingPortalUrl: c.var.profile.billingPortalUrl,
        });

        // Delivery happens here because this is the only place holding both the
        // provider and the run's own record of who was invited, and it goes
        // through the SAME provider call the team page uses rather than a
        // second send path. A failure is NOT rolled back: the invitation exists
        // and its seat is taken, and pressing apply again would skip the row
        // and send nothing. So both numbers are reported instead of a clean
        // success, and resending stays the team page's action.
        let invitesSent = 0;
        let invitesFailed = 0;
        for (const invite of result.invites) {
            try {
                await c.var.services.email.sendInvitation(
                    invite.email, `${getBaseUrl(c)}/join?token=${invite.token}`,
                );
                invitesSent++;
            } catch {
                invitesFailed++;
            }
        }

        return c.json({
            success: true as const,
            data: {
                status: result.status,
                applied: result.applied,
                skipped: result.skipped,
                failed: result.failed,
                invitesSent,
                invitesFailed,
            },
        }, 200);
    })
    .openapi(revertRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const { tenantId } = await loadGatedBatch(c, batchId);
        const revert = new MigrationRevertService(c.env.DB);
        const data = await revert.revert({ tenantId, batchId });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(assistanceRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        // The floor on this route is manager, but the decision to put a file of
        // somebody else's personal data in front of an outside person is an
        // owner's. Who may import data and who may make that call are not the
        // same question — and the manager refused here can still apply the run.
        if (c.get('userRole') !== 'owner') {
            throw Errors.Forbidden('Only an owner can allow a person to open this file.');
        }
        const { db, batch, tenantId } = await loadGatedBatch(c, batchId);
        if (batch.status !== MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE) {
            throw Errors.Conflict('This import does not need converting.');
        }
        await db.update(migrationBatches).set({
            staffAccessAuthorizedBy: c.get('user').sub,
            staffAccessAuthorizedAt: new Date(),
            // The version is stored verbatim, never derived: what somebody
            // agreed to is the wording that was on the screen at the time.
            staffAccessAuthorizationVersion: STAFF_ACCESS_AUTHORIZATION_VERSION,
        }).where(and(eq(migrationBatches.id, batchId), eq(migrationBatches.tenantId, tenantId)));
        return c.json({ success: true as const, data: { status: batch.status } }, 200);
    })
    .openapi(abandonRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const { db, batch, tenantId } = await loadGatedBatch(c, batchId);
        if (!ABANDONABLE.includes(batch.status)) {
            throw Errors.Conflict(
                'This import has been applied. Its entries are the only record of where the imported '
                + 'rows came from, so undo it instead.',
            );
        }
        // The file goes FIRST. A row deleted with its object left behind is a
        // third party's personal data retained under an authorisation for a run
        // that no longer exists, and nothing left would know the key to sweep.
        if (batch.sourceKey) {
            await new MigrationSourceFileService(c.env.PHOTOS).remove([batch.sourceKey]);
        }
        await db.delete(migrationRows).where(and(
            eq(migrationRows.batchId, batchId),
            eq(migrationRows.tenantId, tenantId),
        ));
        await db.delete(migrationBatches).where(and(
            eq(migrationBatches.id, batchId),
            eq(migrationBatches.tenantId, tenantId),
        ));
        return c.json({ success: true as const, data: { deleted: true as const } }, 200);
    });

export type MigrationIntakeApi = typeof migrationIntakeRoutes;
export default migrationIntakeRoutes;
