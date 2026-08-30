/**
 * Updating an imported comment pack — the 1:N kind's update verb.
 *
 * Moved out of `MarketplaceService` verbatim (behaviour unchanged) because that
 * class is at its size ceiling and every other verb's mechanics already live
 * beside this file: the pack parser, the row inserter, the replace planner, the
 * 1:1 local-template writer, the un-import and the reinstall. The service is the
 * dispatcher; this is one of the things it dispatches to.
 *
 * The two modes are genuinely different operations rather than a flag:
 *
 *   - 'append' (the default, and the legacy behaviour): the new pack's rows are
 *     added ALONGSIDE the prior import's. Risks duplication when the catalogue
 *     bumps a library from 248 entries to 248 + 248.
 *   - 'replace': every comment carrying this library_id for this tenant is
 *     deleted first, then the new pack is inserted. Comments the workspace wrote
 *     itself (library_id IS NULL) are never in range, and rows it REWROTE
 *     survive unless the caller has explicitly accepted losing them (#348).
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { eq, sql } from 'drizzle-orm';
import type { PackEntry } from '../../lib/library-edit-marker';
import { marketplaceLibraries, tenantLibraryImports } from '../../lib/db/schema/marketplace';
import { insertLibraryComments } from './library-insert';
import { parseLibraryComments } from './library-pack';
import { applyReplaceMode, resolveLibraryUpdate } from './library-replace';
import { writeImportHistory } from './import-history';

/** The service's `drizzle(env.DB)` handle. Named so this signature does not
 *  silently narrow to the schema-less default and reject its only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

type LibraryUpdateMode = 'append' | 'replace';

export interface UpdateLibraryImportOptions {
    mode?: LibraryUpdateMode;
    /**
     * The destructive choice, and it is enforced rather than merely recorded
     * (#348). Replace mode defaults to KEEPING rows the tenant rewrote; passing
     * true is the caller stating, deliberately, that those rewrites should be
     * deleted along with everything else. Nothing else in this codebase should
     * default it to true.
     */
    confirmLossOfEdits?: boolean;
    /** User id for the history row (S2-8). Defaults to 'system'. */
    userId?: string;
}

export interface UpdateLibraryImportResult {
    rowsAdded: number;
    rowsDeleted: number;
    /** Rows the tenant had rewritten and that this update did not delete. */
    rowsPreserved: number;
    fromSemver: string;
    toSemver: string;
    libraryName: string;
    mode: LibraryUpdateMode;
}

/**
 * Throws `Errors.BadRequest` if no prior import exists, if the import was
 * uninstalled, or if the catalogue version has not advanced past the imported
 * semver — all three decided by `resolveLibraryUpdate`, so the update and the
 * replace preview refuse on exactly the same terms.
 */
export async function updateLibraryImport(
    db: MarketplaceDb,
    rawDb: D1Database,
    tenantId: string,
    libraryId: string,
    options: UpdateLibraryImportOptions = {},
): Promise<UpdateLibraryImportResult> {
    const mode: LibraryUpdateMode = options.mode ?? 'append';
    const userId = options.userId ?? 'system';

    const { lib, existing } = await resolveLibraryUpdate(db, tenantId, libraryId);

    if (lib.kind !== 'comments') {
        throw new Error(`Library kind '${lib.kind}' not yet supported for update`);
    }

    const fromSemver = existing.importedSemver;
    const now = new Date();
    let rowsDeleted = 0;
    let rowsPreserved = 0;

    let entries: PackEntry[] = parseLibraryComments(lib.schema);

    // S2-7 — Replace mode clears the prior import's rows before inserting the
    // new pack. #348 — but not the ones the inspector rewrote, unless the caller
    // has explicitly accepted losing them.
    if (mode === 'replace') {
        const outcome = await applyReplaceMode(
            db, tenantId, libraryId, entries,
            options.confirmLossOfEdits !== true,
        );
        rowsDeleted   = outcome.rowsDeleted;
        rowsPreserved = outcome.rowsPreserved;
        entries       = outcome.entries;
    }

    // Insert the new pack's entries (all fresh UUIDs, each stamped with the
    // import hash that makes the NEXT update able to ask this same question).
    const rowsAdded = await insertLibraryComments(rawDb, tenantId, libraryId, entries);

    // Update the marker. Replace mode resets rowCount to the new size; append
    // mode accumulates as before.
    const newRowCount = mode === 'replace'
        ? rowsAdded + rowsPreserved
        : (existing.rowCount + rowsAdded);
    await db
        .update(tenantLibraryImports)
        .set({
            importedSemver: lib.semver,
            importedAt:     now,
            rowCount:       newRowCount,
        })
        .where(eq(tenantLibraryImports.id, existing.id));

    await db
        .update(marketplaceLibraries)
        .set({ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now })
        .where(eq(marketplaceLibraries.id, libraryId));

    // Sprint 2 S2-8 — write history. action='replace' surfaces the destructive
    // event distinctly from a plain 'update' (append).
    await writeImportHistory(db, tenantId, {
        libraryId,
        action:        mode === 'replace' ? 'replace' : 'update',
        sourceVersion: fromSemver,
        targetVersion: lib.semver,
        rowsAffected:  rowsAdded,
        metadata: {
            libraryName: lib.name,
            kind:        lib.kind,
            rowsAdded,
            rowsDeleted,
            rowsPreserved,
            confirmLossOfEdits: !!options.confirmLossOfEdits,
        },
        userId,
    });

    return {
        rowsAdded,
        rowsDeleted,
        rowsPreserved,
        fromSemver,
        toSemver:    lib.semver,
        libraryName: lib.name,
        mode,
    };
}
