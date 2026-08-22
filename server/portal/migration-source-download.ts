import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { getDrizzle } from '../lib/route-helpers';
import { migrationBatches } from '../lib/db/schema';
import { writeAuditRow } from '../lib/audit';
import { logger } from '../lib/logger';
import { MigrationSourceFileService } from '../services/migration-intake/source-file.service';
import { assertStaffAccessAuthorized } from '../services/migration-intake/staff-access';

/**
 * `GET /api/integration/migration-runs/:batchId/source`
 *
 * Hands a workspace's uploaded import file to the person at the deployment
 * operator who is going to convert it — and writes down that they did.
 *
 * WHY THIS ROUTE EXISTS AT ALL
 * ----------------------------
 * Assisted imports were already possible: the operator authorises staff access,
 * somebody opens the file, somebody delivers a converted bundle back. What was
 * missing is the middle step. `staff-access.ts` names the gap in its own words —
 * the rule it enforces "cannot prevent a file from having been opened — that
 * happens in object storage, where no code of ours is watching." Opening it here
 * puts code of ours in that path, once, at the only moment where the file, the
 * authorisation and the person acting are all in hand at the same time.
 *
 * ⚠️ NOT TENANT-SCOPED FROM THE REQUEST, and it must not be. The caller is the
 * operator's own console, which spans workspaces; the run's `tenant_id` comes
 * off the row and is what the audit is filed under. What stands in for a session
 * here is the M2M signature plus the two checks below, and nothing about the
 * request is trusted except the batch id it names.
 *
 * ⚠️ THE AUDIT WRITE IS AWAITED, AND ITS FAILURE FAILS THE REQUEST. That is a
 * deliberate departure from the house pattern: `auditFromContext` is
 * fire-and-forget precisely so that recording an event can never turn a request
 * that DID happen into a 500, which is right for almost everything. It is wrong
 * here. A download served with no row is exactly the state this route was built
 * to make impossible, so the row goes first and the bytes only follow if it
 * landed. Anyone tempted to "fix" this back to `waitUntil` is restoring the
 * defect.
 */
export async function migrationSourceDownloadHandler(c: Context<HonoConfig>) {
    // An unattributable download is the thing being fixed. The seam's other
    // routes run with no acting person by design — provisioning, seat
    // reconciliation — and that is correct for them; this one may not, because
    // the row it writes would then name nobody.
    const actor = c.get('platformActor');
    if (!actor) {
        return c.json({ success: false, error: { message: 'This call must name the platform person making it.' } }, 403);
    }

    const batchId = c.req.param('batchId');
    const db = getDrizzle(c);
    const batch = await db.select().from(migrationBatches).where(eq(migrationBatches.id, batchId as string)).get();
    if (!batch) return c.json({ success: false, error: { message: 'Migration batch not found' } }, 404);

    // The same rule the delivery and acknowledge routes apply, asked here for
    // the first time BEFORE a file is opened rather than after.
    try {
        assertStaffAccessAuthorized(batch);
    } catch {
        return c.json({
            success: false,
            error: { message: 'This import has no recorded authorisation for a person to open its file.' },
        }, 403);
    }

    if (!batch.sourceKey) return c.json({ success: false, error: { message: 'This import stored no file' } }, 404);
    const bytes = await new MigrationSourceFileService(c.env.PHOTOS).readBytes(batch.sourceKey);
    // Null is normal: the retention sweep deletes these, and a run whose file has
    // expired must not read back as a permission failure.
    if (!bytes) return c.json({ success: false, error: { message: "This import's file is no longer stored" } }, 404);

    try {
        await writeAuditRow({
            db: c.env.DB,
            tenantId: batch.tenantId,
            actorKind: 'platform_staff',
            platformActorId: actor.platformAdminId,
            action: 'migration.source_downloaded',
            entityType: 'migration_batch',
            entityId: batch.id,
            metadata: { ext: batch.sourceKey.slice(batch.sourceKey.lastIndexOf('.') + 1) },
        });
    } catch (e) {
        logger.error('[migration] source download refused — audit row did not land', { batchId }, e instanceof Error ? e : undefined);
        return c.json({ success: false, error: { message: 'Could not record this download, so it was not served.' } }, 500);
    }

    return new Response(bytes as unknown as ArrayBuffer, {
        headers: {
            'content-type': 'application/octet-stream',
            // The batch id, never the workspace's own filename: that name is the
            // customer's and has no business being retyped by us.
            'content-disposition': `attachment; filename="${batch.id}-source"`,
        },
    });
}
