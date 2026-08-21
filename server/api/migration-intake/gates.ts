import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { capabilitiesFor } from '../../lib/middleware/require-capability';
import { getDrizzle } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { migrationBatches, type MigrationIntent } from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS, type MigrationBatchStatus } from '../../lib/status/migration-batch-status';
import type { HonoConfig } from '../../types/hono';

/**
 * Who may do what to an import run — the two questions every intake route asks
 * before it touches anything, and the list of states a run can still be thrown
 * away from.
 *
 * Split out of `migration-intake.ts` when that file crossed the 400-line gate.
 * The seam is not arbitrary: everything here answers "is this actor allowed to
 * act on this run", and knows nothing about what any route then does; the
 * handlers next door know nothing about how the question is answered.
 *
 * ⚠️ These are the IMPORT MODULE's gates and their reach is this directory.
 * `migration-intake.ts` and `route-definitions.ts` are the only importers, and
 * they must stay so. The reasoning that kept `assertIntentAllowed` module-
 * private before the split has not changed — a second spelling of this gate
 * reachable from somewhere that is not an import route is how a gate and the
 * thing it guards come apart. What changed is only which file the module's
 * private surface lives in.
 */

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
 */
export async function assertIntentAllowed(
    c: Context<HonoConfig>,
    intent: MigrationIntent,
): Promise<void> {
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
 * EVERY route does this, not only the one that created the run. The gate that
 * mattered when the file was uploaded is the same gate that matters when the
 * rows are written, and an actor's capabilities can change in between.
 *
 * The 404 comes first and is the same sentence for a run that does not exist
 * and one belonging to somebody else: telling those two apart would confirm
 * that an id is real to a workspace with no business knowing it.
 */
export async function loadGatedBatch(c: Context<HonoConfig>, batchId: string) {
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
export const ABANDONABLE: MigrationBatchStatus[] = [
    MIGRATION_BATCH_STATUS.STAGED,
    MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE,
];
