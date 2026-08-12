import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-7 — schemas for the library "replace" mode update.
 *
 * Replace mode deletes all rows that were inserted by the prior import (matched
 * via comments.library_id) before inserting the new pack. Tenant-authored
 * comments (library_id IS NULL) are never touched.
 */
export const LibraryReplaceParamsSchema = z.object({
    libraryId: z.string().min(1, 'libraryId is required').describe('TODO describe libraryId field for the OpenInspection MCP integration'),
});

export const LibraryReplaceBodySchema = z.object({
    /**
     * The caller's acknowledgement that edits made to rows from the prior
     * import will be lost. It is RECORDED, not enforced: replace mode deletes
     * every row carrying this `library_id` whatever this flag says, and the
     * value is written into the import-history metadata so the destructive
     * update can be read back with the acknowledgement that accompanied it.
     *
     * Nothing detects a user-modified row today, because nothing can — a
     * comment carries no edit marker, so an edited import row is
     * indistinguishable from a freshly imported one. Refusing replace on
     * "has edits" needs a per-row edit timestamp first; until that exists,
     * the honest contract is a recorded acknowledgement rather than a check
     * that would silently pass on every row.
     */
    confirmLossOfEdits: z.boolean().default(false).describe('TODO describe confirmLossOfEdits field for the OpenInspection MCP integration'),
}).optional();
