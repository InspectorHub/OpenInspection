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
 *  - It is complete. The first attempt may have died anywhere after writing the
 *    inspection. The create pipeline (`services/inspection/create-pipeline`) ends
 *    with the primary report, so a missing report means it did not finish, and the
 *    replay runs it again from the replay's own request body: the roster entry, the
 *    automation notices, the client contact, the people links, the service lines
 *    and their prices, the audit row, then the report and results row. Every step
 *    is safe to repeat, and to run at the same moment as another run of it (the
 *    create itself, or a second replay), so a pipeline that did reach some of
 *    them adds nothing twice. A replay of an inspection that is whole writes
 *    nothing, and the quota and the discount are never spent again.
 */

import type { Context } from 'hono';
import { AppError, ErrorCode } from '../../lib/errors';
import { canAccessInspectionCollab } from '../../lib/collab/can-access';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { ensurePrimaryReportAndResults } from '../../lib/inspection/primary-report';
import { resolvePrimaryReportId } from '../../lib/inspection/reports';
import { getDrizzle } from '../../lib/route-helpers';
import type { CreateInspectionData, Inspection } from '../../services/inspection/shared';
import type { HonoConfig } from '../../types/hono';
import { fireQuotaThresholdNotice, recordCreateAudit, resolveCreateInput } from './create-support';

export async function completeReplayedCreate(c: Context<HonoConfig>, existing: Inspection, body: CreateInspectionData): Promise<Inspection> {
    const tenantId = c.get('tenantId');
    const userId = c.get('user')?.sub;
    const db = getDrizzle(c);
    const roster = userId ? await getInspectionRoster(db, tenantId, existing.id) : null;
    const may = !!userId && !!roster
        && (existing.inspectorId === userId || canAccessInspectionCollab(roster, { id: userId, role: c.get('userRole') ?? '' }));
    if (!may) throw new AppError(409, ErrorCode.ID_CONFLICT, 'That inspection id is already in use.');

    if (!await resolvePrimaryReportId(db, tenantId, existing.id)) {
        await c.var.services.inspection.completeInterruptedCreate(
            tenantId, existing, await resolveCreateInput(c, body),
            { beforeReport: (id) => recordCreateAudit(c, id, existing.propertyAddress) },
        );
        // The first attempt answered an error, so it never reached its own notice. The notice is deduplicated.
        fireQuotaThresholdNotice(c, tenantId);
    }
    // A report written, then a failure before its results row: nothing else adds the row.
    await ensurePrimaryReportAndResults(db, tenantId, existing.id, existing.templateId ?? null, new Date());
    return existing;
}
