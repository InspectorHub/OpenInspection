/**
 * Repair Request Builder — request-body schemas.
 *
 * These two lived INLINE in `server/api/repair-builder/crud-routes.ts` until
 * #275, against the house rule that every Zod schema lives here. They moved
 * together rather than one at a time: adding a second home for the item shape
 * while leaving its sibling behind is worse than either end state.
 *
 * ⚠️ The item body is INLINED into `server/lib/mcp/openapi-snapshot.json` (grep
 * it for `ItemBodySchema` and you get nothing), so the move alone changes no
 * serialized name and cannot break `snapshot-drift`. A new FIELD does change it
 * — run `npm run mcp:snapshot`.
 */

import { z } from '@hono/zod-openapi';
import { REPAIR_ACTION_TAGS } from '../repair-action-tag';

/**
 * #275 — the buyer's requested remedy. Nullable AND optional, and the two mean
 * different things on the PATCH path: absent leaves the stored tag alone, an
 * explicit null clears it. The vocabulary comes from `lib/repair-action-tag.ts`
 * so the column, this boundary and the service cannot disagree.
 */
const RepairActionTagSchema = z.enum(REPAIR_ACTION_TAGS)
    .nullable()
    .optional()
    .describe('What the buyer is asking for on this line: repair / replace / fund / other. Buyer- or agent-authored only; an inspector-authored tag is refused with 403. Null or absent = untagged, which is the pre-#275 state and stays valid.');

export const ItemBodySchema = z.object({
    findingKey:           z.string().describe('Stable per-defect key from the report source list.'),
    sectionTitle:         z.string().describe('Report section title snapshot for this defect.'),
    itemLabel:            z.string().describe('Report item label snapshot for this defect.'),
    // IA-55 — snapshot the defect title / location / category at add time so the
    // public share page stays stable even if the report changes later.
    defectTitle:          z.string().nullable().optional().describe('Defect title snapshot at add time.'),
    location:             z.string().nullable().optional().describe('Defect location snapshot at add time.'),
    category:             z.string().nullable().optional().describe('Defect category snapshot at add time.'),
    // IA-57 — the recommended trade, so the shared list tells a contractor which
    // trade to send instead of hiding it inside the comment prose.
    trade:                z.string().nullable().optional().describe('Recommended trade snapshot at add time.'),
    commentSnapshot:      z.string().nullable().optional().describe('Defect comment text snapshot at add time.'),
    requestedCreditCents: z.number().int().min(0).nullable().optional().describe('Requested repair credit in integer cents.'),
    note:                 z.string().nullable().optional().describe('Buyer note explaining the requested credit.'),
    repairActionTag:      RepairActionTagSchema,
});

export const ItemPatchSchema = z.object({
    requestedCreditCents: z.number().int().min(0).optional().describe('Requested repair credit in integer cents.'),
    note:                 z.string().optional().describe('Buyer note explaining the requested credit.'),
    sortOrder:            z.number().int().optional().describe('Display order of this item in the list.'),
    repairActionTag:      RepairActionTagSchema,
});
