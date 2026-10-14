/**
 * Answering a create that named an inspection id which already exists.
 *
 * A device that mints its own ids retries a create after a lost response, and
 * the retry must succeed, but two things have to hold before the existing record
 * is handed back:
 *
 *  - The caller may see it. The record is returned in full, so the replay applies
 *    the rule that decides who may work an inspection (`canAccessInspectionCollab`:
 *    owners and managers, and whoever the roster names). A member who is not on it
 *    gets the same 409 `ID_CONFLICT` as for an id held outside the company, so the
 *    answer does not reveal that the inspection exists. The inspection's own
 *    `inspector_id` also counts: it is written with the row, while the roster is
 *    written moments later, and a retry that races its own first attempt must not
 *    be told the id is taken.
 *  - It is complete. The first attempt may have died between writing the
 *    inspection and writing its report, results row and assignment, and nothing
 *    else would ever add them (the collab route answers 404 without a primary
 *    report and 403 to an assignee who is on no roster), so the replay adds
 *    whatever is missing. It is idempotent and writes nothing for an inspection
 *    that is whole. The assignment is only added to an inspection nobody is
 *    assigned to, so it can never undo a later reassignment.
 */

import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { AppError, ErrorCode } from '../../lib/errors';
import { canAccessInspectionCollab } from '../../lib/collab/can-access';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { ensurePrimaryReportAndResults } from '../../lib/inspection/primary-report';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { inspectionInspectors } from '../../lib/db/schema';
import { getDrizzle } from '../../lib/route-helpers';
import type { Inspection } from '../../services/inspection/shared';
import type { HonoConfig } from '../../types/hono';

export async function completeReplayedCreate(c: Context<HonoConfig>, existing: Inspection): Promise<Inspection> {
    const tenantId = c.get('tenantId');
    const userId = c.get('user')?.sub;
    const db = getDrizzle(c);
    const roster = userId ? await getInspectionRoster(db, tenantId, existing.id) : null;
    const may = !!userId && !!roster
        && (existing.inspectorId === userId || canAccessInspectionCollab(roster, { id: userId, role: c.get('userRole') ?? '' }));
    if (!may) throw new AppError(409, ErrorCode.ID_CONFLICT, 'That inspection id is already in use.');
    await ensurePrimaryReportAndResults(db, tenantId, existing.id, existing.templateId ?? null, new Date());
    if (existing.inspectorId) {
        const assigned = await db.select({ userId: inspectionInspectors.userId }).from(inspectionInspectors)
            .where(and(eq(inspectionInspectors.tenantId, tenantId), eq(inspectionInspectors.inspectionId, existing.id))).limit(1);
        if (assigned.length === 0) await syncInspectionAssignments(db, tenantId, existing.id, { inspectorId: existing.inspectorId });
    }
    return existing;
}
