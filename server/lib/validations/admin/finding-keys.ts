import { z } from '@hono/zod-openapi';

/** What a results document answers to `/rename-legacy-keys`. Parsed on the Worker side, never trusted as typed. */
export const LegacyRenameCountsSchema = z.object({
    renamed:          z.number().int().nonnegative(),
    skippedMeta:      z.number().int().nonnegative(),
    skippedUnknown:   z.number().int().nonnegative(),
    skippedAmbiguous: z.number().int().nonnegative(),
    conflicts:        z.number().int().nonnegative(),
});

/**
 * The `data` of the finding-key migration response.
 *
 * Every results row examined ends in exactly one of `migrated`, `delegated`,
 * `failed` or `skipped`, so `processed = migrated + delegated + failed + skipped`.
 * An inspection with no results row examines nothing and counts nowhere.
 */
export const FindingKeyMigrationResultSchema = z.object({
    processed: z.number().describe('Results rows examined. Equals migrated + delegated + failed + skipped.'),
    migrated: z.number().describe('Rows without a live document whose keys were rewritten in the database.'),
    skipped: z.number().describe('Rows with nothing to do: no data, no legacy key, or only keys the template does not name.'),
    delegated: z.number().describe('Rows whose live collaborative document was asked to rename its own keys and answered.'),
    failed: z.number().describe('Rows whose live document could not be asked, or refused. Nothing was rewritten for them.'),
    failedIds: z.array(z.string()).describe('Inspection ids of the failed rows.'),
    renamedInDocuments: z.number().describe('Items the live documents moved onto their composite keys, summed over delegated rows.'),
    conflicts: z.number().describe('Scalar fields where a document held different content under the old and the new key; the new key was kept. The old value is in that document\'s "pre-rename" version-history snapshot.'),
});

export type FindingKeyMigrationResult = z.infer<typeof FindingKeyMigrationResultSchema>;
export type LegacyRenameCounts = z.infer<typeof LegacyRenameCountsSchema>;
