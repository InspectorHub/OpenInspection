/**
 * The repair builder and the repair share page answer from field lists, not from the rows (server/lib/response-projection.ts).
 *
 * The request row also holds the company id and who built the list and by which route (a contact id, an agent id or a staff user
 * id). The list carries when its link expires and whether it was revoked: the agent page reads both to tell a live link from a
 * dead one. The line row holds the company id and the parent list id. None of that is read by the
 * pages, so none of it is carried. The lists are checked against the schemas in validations/repair-request-view.schema.ts.
 */
import type { repairRequests, repairRequestItems } from './db/schema';
import { projectFields } from './response-projection';

type RequestRow = typeof repairRequests.$inferSelect;
type LineRow = typeof repairRequestItems.$inferSelect;

const REQUEST_FIELDS = ['id', 'inspectionId', 'customIntro', 'shareToken', 'createdAt', 'updatedAt', 'expiresAt', 'revokedAt'] as const;
const SHARE_LINE_FIELDS = [
    'id', 'sectionTitle', 'itemLabel', 'defectTitleSnapshot', 'locationSnapshot', 'categorySnapshot', 'tradeSnapshot',
    'commentSnapshot', 'requestedCreditCents', 'note', 'sortOrder', 'repairActionTag',
] as const;
const BUILDER_LINE_FIELDS = [...SHARE_LINE_FIELDS, 'findingKey'] as const;

export const projectRepairRequest = (row: RequestRow) => projectFields(row, REQUEST_FIELDS);
export const projectRepairShareLine = (row: LineRow) => projectFields(row, SHARE_LINE_FIELDS);
export const projectRepairBuilderLine = (row: LineRow) => projectFields(row, BUILDER_LINE_FIELDS);

export function projectRepairRequestWithLines(row: RequestRow & { items: LineRow[] }) {
    return { ...projectRepairRequest(row), items: row.items.map(projectRepairBuilderLine) };
}

/** The field lists, for the spec that holds them to the schemas. */
export const REPAIR_VIEW_FIELD_LISTS = { request: REQUEST_FIELDS, shareLine: SHARE_LINE_FIELDS, builderLine: BUILDER_LINE_FIELDS } as const;
