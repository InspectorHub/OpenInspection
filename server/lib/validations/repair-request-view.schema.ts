/**
 * What the repair builder and the repair share page receive of a repair request and its lines.
 *
 * These are the public, link-held surfaces (the builder page of a client or agent, and the page a forwarded share link
 * opens), so each response is built from the field lists in server/lib/repair-request-view.ts and these schemas describe
 * exactly those lists. The tables carry more (the company id, who built the list and how); the pages read none of it.
 */
import { z } from '@hono/zod-openapi';
import { REPAIR_ACTION_TAGS } from '../repair-action-tag';

const iso = (what: string) => z.string().describe(`${what} (ISO 8601).`);

const lineFields = {
    id: z.string().describe('Line id.'),
    sectionTitle: z.string().describe('Report section the line comes from, as it read when the line was added.'),
    itemLabel: z.string().describe('Checklist item label, as it read when the line was added.'),
    defectTitleSnapshot: z.string().nullable().describe('Defect title when the line was added, or null.'),
    locationSnapshot: z.string().nullable().describe('Location of the defect when the line was added, or null.'),
    categorySnapshot: z.string().nullable().describe('Defect category when the line was added, or null.'),
    tradeSnapshot: z.string().nullable().describe('Recommended trade when the line was added, or null.'),
    commentSnapshot: z.string().nullable().describe('Report comment when the line was added, or null.'),
    requestedCreditCents: z.number().nullable().describe('Credit requested for the line, in cents, or null.'),
    note: z.string().nullable().describe('The requester note on the line, or null.'),
    sortOrder: z.number().describe('Position of the line in the list.'),
    repairActionTag: z.enum(REPAIR_ACTION_TAGS).nullable().describe('What the requester asks for on this line (repair, replace, fund or other), or null when untagged.'),
};

/** A line as the share page shows it. */
export const RepairShareLineSchema = z.object(lineFields).describe('One line of a shared repair list.');

/** A line as the builder page rehydrates it; it also needs the finding the line answers. */
export const RepairBuilderLineSchema = z.object({
    ...lineFields,
    findingKey: z.string().describe('Key of the report finding the line answers; the builder matches it to the defect it shows.'),
}).describe('One line of a repair list.');

export const RepairRequestViewSchema = z.object({
    id: z.string().describe('Repair request id.'),
    inspectionId: z.string().describe('Inspection the list belongs to.'),
    customIntro: z.string().nullable().describe('Introduction the requester wrote above the list, or null.'),
    shareToken: z.string().describe('Token of the share link for this list.'),
    createdAt: iso('When the list was created'),
    updatedAt: iso('When the list was last changed'),
    expiresAt: iso('When the share link stops working').nullable().describe('When the share link stops working (ISO 8601), or null when it does not expire.'),
    revokedAt: iso('When the share link was revoked').nullable().describe('When the share link was revoked (ISO 8601), or null while it is live.'),
}).describe('A repair request.');

export const RepairRequestWithLinesSchema = RepairRequestViewSchema.extend({
    items: z.array(RepairBuilderLineSchema).describe('The lines of the list.'),
}).describe('A repair request with its lines.');
