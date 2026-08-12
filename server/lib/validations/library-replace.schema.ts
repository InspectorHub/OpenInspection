import { z } from '@hono/zod-openapi';

/**
 * Sprint 2 S2-7 — schemas for the library "replace" mode update.
 *
 * Replace mode swaps the prior import's rows for the new pack's, matched via
 * comments.library_id. Tenant-authored comments (library_id IS NULL) are never
 * touched, and since #348 neither are rows the tenant rewrote — unless the
 * caller explicitly asks for that.
 */
export const LibraryReplaceParamsSchema = z.object({
    libraryId: z.string().min(1, 'libraryId is required').describe('Catalogue id of the imported library to replace'),
});

export const LibraryReplaceBodySchema = z.object({
    /**
     * The caller's acknowledgement that edits made to rows from the prior
     * import will be lost — and, since #348, the thing that actually causes
     * that loss rather than merely describing it.
     *
     * false (the default) keeps every row whose text differs from what was
     * imported and replaces the rest. true deletes all of them, rewrites
     * included. Keeping is the default because the text in a rewritten row is
     * professional work that reached a paying client; losing it has to be
     * chosen, not defaulted into.
     *
     * This flag was inert for as long as it existed, and the reason was
     * honest: a comment carried no edit marker, so an edited import row was
     * indistinguishable from a freshly imported one and a "refuse on edits"
     * check would have passed on every row. comments.import_hash is that
     * missing marker — it records the text each row arrived with, so "edited"
     * now means "differs from what we imported" and the check has something
     * real to test.
     */
    confirmLossOfEdits: z.boolean().default(false).describe('Delete rows the tenant rewrote too. Default false keeps them.'),
}).optional();

/**
 * One conflicted comment: the inspector's words beside the publisher's.
 * Module-private: it exists to be composed into the preview schema below, and
 * nothing outside this file names it. Exporting it made the dead-code gate
 * report an unused public symbol, which is exactly what it was.
 */
const LibraryReplacePairSchema = z.object({
    commentId: z.string().describe('Id of the tenant comment row that was rewritten'),
    section:   z.string().nullable().describe('Section label the comment sits under, when it has one'),
    yours:     z.string().describe("The inspector's current text — what a replace would delete"),
    editedAt:  z.number().nullable().describe('Epoch milliseconds the row was last edited, or null if edited before the marker existed'),
    published: z.object({
        kind: z.enum(['changed', 'unchanged', 'removed']).describe("Whether the new pack alters, still carries, or drops the entry this row came from"),
        text: z.string().nullable().describe("The publisher's version, or null when the entry is gone from the new pack"),
    }).describe("The publisher's side of the pair"),
});

export const LibraryReplacePreviewSchema = z.object({
    libraryId:        z.string().describe('Catalogue id of the library'),
    libraryName:      z.string().describe('Display name of the library'),
    fromSemver:       z.string().describe('Version currently imported'),
    toSemver:         z.string().describe('Version the update would move to'),
    total:            z.number().int().describe('Rows this tenant holds from the prior import'),
    publisherChanged: z.number().int().describe('Of those, how many the new pack alters or drops'),
    edited:           z.number().int().describe('Of those, how many differ from what was imported'),
    pairs:            z.array(LibraryReplacePairSchema).describe('One pair per rewritten row'),
});
