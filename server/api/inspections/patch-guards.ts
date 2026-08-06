/**
 * The soft references an inspection PATCH can dangle, re-resolved before the write.
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
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../../lib/db/schema';

export interface PatchRefusal {
    code: 'INVALID_COVER_PHOTO' | 'INVALID_INSPECTOR' | 'INVALID_REFERRER';
    message: string;
}

/** Only the three fields this checks; the rest of the body is none of its business. */
interface GuardedPatch {
    coverPhotoId?: string | null | undefined;
    inspectorId?: string | null | undefined;
    referredByContactId?: string | null | undefined;
}

export async function findPatchRefusal(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    body: GuardedPatch,
    // Ownership of a photo key is an inspection-service question (it spans the
    // item photos and the loose pool), so it stays where that knowledge lives.
    isInspectionPhotoKey: (id: string, tenantId: string, key: string) => Promise<boolean>,
): Promise<PatchRefusal | null> {
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
