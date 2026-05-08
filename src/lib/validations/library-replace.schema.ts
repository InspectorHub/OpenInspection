import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-7 — schemas for the library "replace" mode update.
 *
 * Replace mode deletes all rows that were inserted by the prior import (matched
 * via comments.library_id) before inserting the new pack. Tenant-authored
 * comments (library_id IS NULL) are never touched.
 */
export const LibraryReplaceParamsSchema = z.object({
    libraryId: z.string().min(1, 'libraryId is required'),
});

export const LibraryReplaceBodySchema = z.object({
    /**
     * When true, the caller has acknowledged that user-modified rows from the
     * prior import will be lost. Service refuses replace if this flag is false
     * AND the prior import has any user-modified rows.
     *
     * "User-modified" is detected via the comments `category` or `rating_bucket`
     * field having been touched after the import (we do not track edits at
     * row-level today; future Spec X to introduce a `last_edited_at` column).
     * Until then, we conservatively flag any row whose text differs from the
     * original library entry as user-modified.
     */
    confirmLossOfEdits: z.boolean().default(false),
}).optional();

export type LibraryReplaceBody = z.infer<typeof LibraryReplaceBodySchema>;
