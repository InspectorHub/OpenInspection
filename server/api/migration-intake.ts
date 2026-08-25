import { and, desc, eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { getBaseUrl } from '../lib/repair-gates';
import { getDrizzle } from '../lib/route-helpers';
import { auditFromContext } from '../lib/audit';
import { Errors } from '../lib/errors';
import { migrationBatches, migrationRows } from '../lib/db/schema';
import type { VendorId } from '../lib/migration-intake/bundle';
import { MIGRATION_BATCH_STATUS } from '../lib/status/migration-batch-status';
import { assertSourceSizeWithin, limitsFor } from '../lib/migration-intake/limits';
import {
    buildBundle,
    defaultMappingFor,
    intakeSourceFromBytes,
    matchAdapter,
} from '../lib/migration-intake/adapters/registry';
import { assertConversionByPersonAvailable } from '../lib/migration-intake/unreadable-file';
import { assertStaffAccessDecisionIsOwners } from '../services/migration-intake/staff-access';
import { announceWaitingRun } from '../services/migration-intake/waiting-run-notice';
import { MigrationStageService } from '../services/migration-intake/stage.service';
import { MigrationReportService } from '../services/migration-intake/report.service';
import { MigrationApplyService } from '../services/migration-intake/apply.service';
import { MigrationRevertService } from '../services/migration-intake/revert.service';
import { MigrationRepairService } from '../services/migration-intake/repair.service';
import { MigrationSourceFileService, extForFileName } from '../services/migration-intake/source-file.service';
import { expiryFor } from '../services/migration-intake/assistance.service';
import { ABANDONABLE, assertIntentAllowed, loadGatedBatch } from './migration-intake/gates';
import {
    abandonRoute,
    applyRoute,
    createBatchRoute,
    getBatchRoute,
    listBatchesRoute,
    remapRoute,
    repairRowRoute,
    revertRoute,
} from './migration-intake/route-definitions';

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
        // By SIZE, not by a trimmed decode. A container format whose bytes
        // happen to decode to whitespace is a file, not an empty upload.
        if (file.size === 0) throw Errors.BadRequest('That file is empty.');

        const bytes = new Uint8Array(await file.arrayBuffer());
        const ext = extForFileName(file.name);
        // The file's own length. Measuring a re-encoding of a decode inflates a
        // binary by every byte the decode replaced.
        assertSourceSizeWithin(limits, ext, bytes.byteLength);

        const source = intakeSourceFromBytes(file.name, bytes);
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
            const sourceKey = await files.put(tenantId, sourceId, ext, bytes);
            try {
                return await write(sourceKey);
            } catch (err) {
                await files.remove([sourceKey]);
                throw err;
            }
        };

        /** Nothing here can read it: the run waits for a person, or it is refused unstored. */
        const openWaitingRun = async () => {
            // BOTH doors into a waiting run pass through here, which is why the
            // owner rule is stated here rather than only on the intent that
            // names assistance outright. `assertIntentAllowed` sees the intent
            // the operator chose; whether the file turns out to be readable is
            // decided afterwards, so a manager importing contacts could reach
            // this exact decision — put a third party's file in front of an
            // outside person — through a gate that never asked about it.
            // Order matters. Whether this path EXISTS is asked first, because on
            // a deployment with no support path "only an owner can decide" would
            // be false — no owner can either.
            assertConversionByPersonAvailable(profile, staffAccessAuthorized);
            assertStaffAccessDecisionIsOwners(c.get('userRole'));
            const expiresAt = expiryFor(true, now);
            const created = await withStoredFile((sourceKey) => stage.createAssistanceBatch({
                tenantId,
                createdBy: userId,
                intent,
                targetId: form.targetId ?? null,
                sourceKey,
                expiresAt,
                uploadAuthorizedBy: userId,
                staffAccessAuthorizedBy: userId,
            }));
            // The vendor is deliberately absent: nothing has read this file, so
            // naming one would be a guess written into a trail.
            auditFromContext(c, 'migration.assistance_requested', 'migration_batch', {
                entityId: created.batchId,
                metadata: { intent },
            });
            // Tell the DEPLOYMENT OPERATOR, which nothing here used to do. Same
            // NAME as the audit action above, different artefact: that row is
            // this workspace's own trail, this event is the only thing that
            // crosses. See `announceWaitingRun` for the whole of that reasoning.
            announceWaitingRun(c.var.services?.outbox, {
                tenantId,
                batchId: created.batchId,
                vendor: form.vendor ?? null,
                uploadedAt: now,
                expiresAt,
            });
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

        // The operator's own declaration, never derived. A default here was
        // the deleted "the intent decides the vendor" rule in another coat: it
        // made `templates.create` mean one product, so the wizard's picker
        // could be answered and silently ignored. Refused rather than guessed,
        // because the guess is wrong exactly when it matters — for the person
        // whose file came from the other product.
        if (!form.vendor) {
            throw Errors.BadRequest('Say which product this export came from, so the right reader is used.');
        }
        const declaredVendor: VendorId = form.vendor;

        const match = await matchAdapter(intent, declaredVendor, source);
        if (!match) return openWaitingRun();

        const built = await buildBundle(match.vendor, source, defaultMappingFor(intent, match.inspection, source));
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
        // Counts and provenance only. The file name is left out on purpose: an
        // export is routinely named after the person it is about.
        auditFromContext(c, 'migration.staged', 'migration_batch', {
            entityId: staged.batchId,
            metadata: { intent, vendor: match.vendor, rows: staged.rows.length },
        });
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
        const report = new MigrationReportService(c.env.DB, c.env.PHOTOS);
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
        // The mapping itself stays out of the metadata: it is column headings
        // from somebody else's export, and what a trail needs from this event is
        // that the run was re-read under a different one.
        auditFromContext(c, 'migration.remapped', 'migration_batch', { entityId: batchId });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(repairRowRoute, async (c) => {
        const { batchId, rowId } = c.req.valid('param');
        const { payload } = c.req.valid('json');
        const { tenantId } = await loadGatedBatch(c, batchId);
        const repair = new MigrationRepairService(c.env.DB, c.env.PHOTOS);
        const data = await repair.repairRow({ tenantId, batchId, rowId, payload });
        // The corrected VALUES stay out of the metadata: they are a third
        // party's contact details, and the fact that this entry was edited is
        // the part an audit trail is for. This and the re-map above are the only
        // two actions on the pipeline that rewrite third-party personal data by
        // hand, so a trail recording apply, undo and abandon but not these would
        // be missing precisely the step a person typed.
        auditFromContext(c, 'migration.row_repaired', 'migration_row', { entityId: rowId });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(applyRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const body = c.req.valid('json');
        const { batch, tenantId } = await loadGatedBatch(c, batchId);

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

        // Both invitation numbers are recorded, not just the successes: a run
        // that sent nine of ten is the one somebody comes back to ask about,
        // and a trail that logged only the nine could not tell it from a run of
        // nine.
        auditFromContext(c, 'migration.applied', 'migration_batch', {
            entityId: batchId,
            metadata: {
                intent: batch.intent,
                applied: result.applied,
                skipped: result.skipped,
                failed: result.failed,
                invitesSent,
                invitesFailed,
            },
        });

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
        // A COUNT of refusals, not the refusals: each one carries the reason an
        // entry could not be taken back, and those reasons name the entry.
        auditFromContext(c, 'migration.reverted', 'migration_batch', {
            entityId: batchId,
            metadata: { reverted: data.reverted, refused: data.refused.length },
        });
        return c.json({ success: true as const, data }, 200);
    })
    /*
     * There is deliberately NO route here for recording the staff-access
     * agreement after the fact.
     *
     * A run only reaches `needs_assistance` through the upload above, which
     * refuses — and stores nothing — unless that agreement came with the
     * request; `createAssistanceBatch` then writes the name, the instant and
     * the wording version in the same insert as the row. So there is no such
     * thing as a waiting run missing the authorisation, and a route to add one
     * later would have no reachable input. `routes-create.spec.ts` pins that
     * property on the runs the real upload path produces.
     */
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
        // Written AFTER the row is gone, and it is the only thing left that says
        // the run existed: this route deletes the record rather than clearing
        // it, unlike the retention sweep, because the operator asked for it to
        // go rather than simply stopping.
        auditFromContext(c, 'migration.abandoned', 'migration_batch', { entityId: batchId });
        return c.json({ success: true as const, data: { deleted: true as const } }, 200);
    });

export type MigrationIntakeApi = typeof migrationIntakeRoutes;
export default migrationIntakeRoutes;
