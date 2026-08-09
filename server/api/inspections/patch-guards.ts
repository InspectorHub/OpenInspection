/**
 * What an inspection PATCH must be refused for, and what it must correct, before
 * the write.
 *
 * Two kinds of rule live here, for the same reason: both are conditions the
 * route handler would otherwise carry as look-alike inline blocks, and both are
 * forgotten the same way. `findPatchRefusal` says no; `clearCancellationOnRecovery`
 * says "and while you are here, this other column is now wrong".
 *
 * ── 1. Dangling soft references ─────────────────────────────────────────────
 *
 * Three fields on `UpdateInspection` name a row in another table —
 * `coverPhotoId`, `inspectorId`, `referredByContactId` — and Schema Rules
 * forbid new foreign keys, so nothing in the database objects to a value that
 * points nowhere. A format check is not a substitute either: a UUID from
 * another tenant is still a UUID. Each one has to be resolved INSIDE the
 * caller's tenant, and that is what this does.
 *
 * They are one unit because they fail the same way and are forgotten the same
 * way: whoever adds the fourth such field will find three neighbours here
 * rather than three look-alike blocks strung through a route handler.
 *
 * Returns the refusal (code + message) or null. Deliberately does not build the
 * Response — the route owns its own status codes and envelope shape.
 *
 * ── 2. Cancelling is not a status write (#78) ───────────────────────────────
 *
 * `status: 'cancelled'` is refused outright. See ./cancel-write-path for why —
 * in one line: the fee, the refund and the recorded reason happen only inside
 * `POST /:id/cancel`, so any other writer produces a cancelled job whose money
 * still says it is on.
 *
 * LEAVING `cancelled` IS REFUSED TOO (#81), and for the mirror reason. Recovery
 * has to clear the cancellation record, record who did it and put the calendar
 * entry back; this PATCH only ever did the first two, and the bulk door did
 * none of them. `POST /:id/uncancel` does all three, so it is the one door back
 * and this one points at it.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../../lib/db/schema';
import {
    refuseCancelViaStatusWrite,
    refuseLeaveCancelledViaStatusWrite,
    type CancelWritePathRefusal,
} from './cancel-write-path';

export type PatchRefusal = CancelWritePathRefusal | {
    code: 'INVALID_COVER_PHOTO' | 'INVALID_INSPECTOR' | 'INVALID_REFERRER';
    message: string;
};

/** Only the fields this checks; the rest of the body is none of its business. */
interface GuardedPatch {
    coverPhotoId?: string | null | undefined;
    inspectorId?: string | null | undefined;
    referredByContactId?: string | null | undefined;
    status?: string | null | undefined;
}

export async function findPatchRefusal(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    body: GuardedPatch,
    // Ownership of a photo key is an inspection-service question (it spans the
    // item photos and the loose pool), so it stays where that knowledge lives.
    isInspectionPhotoKey: (id: string, tenantId: string, key: string) => Promise<boolean>,
    /** What the row says NOW — the only way to recognise a recovery (#81). */
    currentStatus?: string | null,
): Promise<PatchRefusal | null> {
    // #78 — checked FIRST, and it refuses the whole patch rather than dropping
    // the one field. A patch that saved the county and quietly discarded the
    // cancellation is worse than either outcome: nothing on screen would say
    // which half took effect.
    const cancelRefusal = refuseCancelViaStatusWrite(body.status);
    if (cancelRefusal) return cancelRefusal;

    // #81 — the same refusal pointing the other way, and gated on `body.status`
    // being present at all: a cancelled inspection is still editable. Correcting
    // its address, or attaching the note that explains the cancellation, is
    // ordinary work and must not be refused because of the status it is in.
    if (body.status) {
        const leaveRefusal = refuseLeaveCancelledViaStatusWrite(currentStatus);
        if (leaveRefusal) return leaveRefusal;
    }

    // DB-16 — coverPhotoId holds the R2 key of a photo belonging to THIS
    // inspection (an attached item photo or a loose pool photo); null clears
    // the cover. Reject foreign/dangling keys so the preflight gate + report
    // renderer can always resolve the image.
    if (typeof body.coverPhotoId === 'string') {
        if (!(await isInspectionPhotoKey(inspectionId, tenantId, body.coverPhotoId))) {
            return { code: 'INVALID_COVER_PHOTO', message: 'coverPhotoId does not reference a photo of this inspection' };
        }
    }

    // `inspectorId` names a row in `users`, and nothing downstream re-checks
    // it: the value is written straight onto the inspection and mirrored into
    // the assignment link table.
    if (typeof body.inspectorId === 'string') {
        const member = await db.select({ id: users.id }).from(users)
            .where(and(
                eq(users.id, body.inspectorId),
                eq(users.tenantId, tenantId),
                isNull(users.deletedAt),
            ))
            .limit(1).get();
        if (!member) {
            return { code: 'INVALID_INSPECTOR', message: 'inspectorId is not a member of this tenant' };
        }
    }

    // Task 8 — a referrer must be one of THIS tenant's contacts. Refuse a
    // foreign or unknown id rather than writing a dangling soft reference.
    if (typeof body.referredByContactId === 'string' && body.referredByContactId) {
        const { contacts } = await import('../../lib/db/schema');
        const owner = await db.select({ id: contacts.id }).from(contacts)
            .where(and(eq(contacts.id, body.referredByContactId), eq(contacts.tenantId, tenantId)))
            .get();
        if (!owner) {
            return { code: 'INVALID_REFERRER', message: 'referredByContactId is not a contact in this tenant' };
        }
    }

    return null;
}
