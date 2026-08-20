import type { migrationBatches } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { ROLE } from '../../lib/auth/roles';

/**
 * The one rule about putting somebody else's file in front of an outside
 * person, stated once and enforced at both ends of it.
 *
 * The two ends are different questions and neither implies the other:
 *   - WHO may decide it (`assertStaffAccessDecisionIsOwners`), asked at the
 *     moment the run is opened, before anything is stored;
 *   - WHETHER that decision was ever recorded (`assertStaffAccessAuthorized`),
 *     asked again every time somebody acts on the file afterwards.
 *
 * They live together because they are the same policy, and because they were
 * previously apart: the role half existed only on the intent that names
 * assistance outright, so the same run reached through the unreadable-file
 * fallback was opened by whoever could import contacts.
 */

/**
 * Whether this actor may decide to have a person open somebody else's file.
 *
 * An owner's call, and NOT the same question as who may run an import. The
 * intent gate answers the second one — a manager may import contacts — and a
 * file no adapter can read turns that import into this decision partway
 * through, which is why the check cannot live on the intent alone.
 */
export function assertStaffAccessDecisionIsOwners(role: string | undefined): void {
    if (role === ROLE.OWNER) return;
    throw Errors.Forbidden(
        'Nothing here can read that file, and only an owner can decide to have somebody open it.',
    );
}

/**
 * Refuses to act on a run whose staff access was never authorised.
 *
 * All three columns, not one. A `by` with no `at` is a row somebody
 * half-wrote; a version with no subject cannot be read back as an answer to
 * "who agreed". Any of the three missing means there is no authorisation to
 * point at.
 *
 * This cannot prevent a file from having been opened — that happens in object
 * storage, where no code of ours is watching. What it does is make breaking
 * the rule produce a FAILURE rather than a silent success, which is the
 * difference between a rule and a sentence in a document.
 */
export function assertStaffAccessAuthorized(
    batch: Pick<
        typeof migrationBatches.$inferSelect,
        'staffAccessAuthorizedBy' | 'staffAccessAuthorizedAt' | 'staffAccessAuthorizationVersion'
    >,
): void {
    const complete = Boolean(batch.staffAccessAuthorizedBy)
        && batch.staffAccessAuthorizedAt !== null
        && Boolean(batch.staffAccessAuthorizationVersion);
    if (complete) return;
    throw Errors.Forbidden(
        'This import has no recorded authorisation for a person to open its file, so nothing may be delivered into it.',
    );
}
