/**
 * Deciding what a library "replace" would cost, before any of it happens (#348).
 *
 * Replace mode swaps the rows a previous import created for the current
 * release's. What makes that safe to offer is that a row the tenant rewrote can
 * now be told apart from one that arrived as-is — see
 * `server/lib/library-edit-marker.ts` for why that rests on a content hash
 * captured at import time rather than on an "edited" timestamp.
 *
 * These helpers are free functions rather than methods so the preview and the
 * update itself provably ask the same questions of the same data. A preview that
 * could disagree with the operation it previews is worse than none.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { eq, and, notInArray } from 'drizzle-orm';
import { comments } from '../../lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../lib/db/schema/marketplace';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { buildReplacePlan, type EditPair, type PackEntry } from '../../lib/library-edit-marker';
import { parseLibraryComments } from './library-pack';

/** The service's `drizzle(env.DB)` handle. Named so these signatures do not
 *  silently narrow to the schema-less default and reject their only caller. */
type LibraryDb = DrizzleD1Database<Record<string, unknown>>;

/** What the import-conflict page reads before offering the choice. */
export interface LibraryReplacePreview {
    libraryId: string;
    libraryName: string;
    fromSemver: string;
    toSemver: string;
    /** Rows this tenant holds from the prior import. */
    total: number;
    /** Of those, how many the publisher altered or dropped in the new pack. */
    publisherChanged: number;
    /** Of those, how many differ from what was imported. */
    edited: number;
    pairs: EditPair[];
}

/**
 * Resolve the catalogue row and this tenant's import marker, applying to the
 * preview the same refusals the update applies. A page that can render a choice
 * the API would reject is a page that produces a broken button.
 */
export async function resolveLibraryUpdate(
    db: LibraryDb,
    tenantId: string,
    libraryId: string,
) {
    // Unscoped by `id` alone, and correctly so: `marketplace_libraries` is the
    // published catalog and carries no `tenant_id` — every workspace may read
    // every published library, which is the point of a marketplace. The
    // tenant-specific half is the import row below, and that one IS scoped.
    // `scripts/tenant-scoping-baseline.json` records this query; it moved here
    // from marketplace.service.ts rather than being introduced.
    const [lib] = await db
        .select()
        .from(marketplaceLibraries)
        .where(eq(marketplaceLibraries.id, libraryId))
        .limit(1);
    if (!lib) throw Errors.NotFound('Marketplace library not found');

    const [existing] = await db
        .select()
        .from(tenantLibraryImports)
        .where(and(
            eq(tenantLibraryImports.tenantId, tenantId),
            eq(tenantLibraryImports.libraryId, libraryId),
        ))
        .limit(1);

    if (!existing) {
        throw Errors.BadRequest('Library has not been imported yet — use Import instead of Update');
    }
    if (existing.importedSemver === lib.semver) {
        throw Errors.BadRequest('No update available — already on the latest version');
    }
    return { lib, existing };
}

/**
 * The prior import's rows for this tenant, in the shape the planner needs.
 * Module-private: `buildLibraryReplacePreview` below is the entry point, and
 * this is the query it runs first.
 */
function priorImportRows(
    db: LibraryDb,
    tenantId: string,
    libraryId: string,
) {
    return db
        .select({
            id:         comments.id,
            text:       comments.text,
            section:    comments.section,
            importHash: comments.importHash,
            editedAt:   comments.editedAt,
        })
        .from(comments)
        .where(and(
            eq(comments.tenantId, tenantId),
            eq(comments.libraryId, libraryId),
        ))
        .all();
}

/**
 * What a replace would cost, computed before anything is deleted.
 *
 * This exists so the choice can be offered at the moment of import, looking at
 * the actual sentences at stake, rather than as a confirmation dialog after the
 * decision has already been framed as a number.
 */
export async function previewLibraryReplace(
    db: LibraryDb,
    tenantId: string,
    libraryId: string,
): Promise<LibraryReplacePreview> {
    const { lib, existing } = await resolveLibraryUpdate(db, tenantId, libraryId);
    if (lib.kind !== 'comments') {
        throw Errors.BadRequest(`Library kind '${lib.kind}' has no replace preview`);
    }

    const plan = await buildReplacePlan(
        await priorImportRows(db, tenantId, libraryId),
        parseLibraryComments(lib.schema),
    );

    return {
        libraryId,
        libraryName:      lib.name,
        fromSemver:       existing.importedSemver,
        toSemver:         lib.semver,
        total:            plan.total,
        publisherChanged: plan.publisherChanged,
        edited:           plan.edited,
        pairs:            plan.pairs,
    };
}

export interface ReplaceModeOutcome {
    rowsDeleted: number;
    /** Rows the tenant had rewritten and that were kept. */
    rowsPreserved: number;
    /** The pack entries still worth inserting after the preserved rows are accounted for. */
    entries: PackEntry[];
}

/**
 * Clear the prior import's rows, keeping the ones the tenant rewrote unless the
 * caller has explicitly accepted losing them.
 *
 * Keeping is the default because the text in those rows is professional work
 * that was paid for once and reaches a client; deleting it is the choice that
 * has to be made deliberately, which is the whole point of #348.
 */
export async function applyReplaceMode(
    db: LibraryDb,
    tenantId: string,
    libraryId: string,
    entries: PackEntry[],
    keepEdits: boolean,
): Promise<ReplaceModeOutcome> {
    const plan = await buildReplacePlan(await priorImportRows(db, tenantId, libraryId), entries);
    const preserve = keepEdits ? plan.preservedIds : [];

    const deleted = await db.delete(comments)
        .where(and(
            eq(comments.tenantId, tenantId),
            eq(comments.libraryId, libraryId),
            ...(preserve.length ? [notInArray(comments.id, preserve)] : []),
        ))
        .run();
    // Drizzle returns a meta object on D1; better-sqlite3 returns
    // { changes: number }. We tolerate both via duck-typing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = (deleted as any)?.meta?.changes ?? (deleted as any)?.changes ?? 0;

    if (!preserve.length) {
        return { rowsDeleted: typeof changes === 'number' ? changes : 0, rowsPreserved: 0, entries };
    }

    // Do not hand back, as a second row, the exact sentence they rewrote: an
    // entry the new pack still ships unchanged and that a preserved row started as.
    const skip = new Set(plan.skipEntryIndexes);
    logger.info('[marketplace] replace preserved tenant-edited comments', {
        tenantId, libraryId, rowsPreserved: preserve.length, skipped: skip.size,
    });
    return {
        rowsDeleted:   typeof changes === 'number' ? changes : 0,
        rowsPreserved: preserve.length,
        entries:       entries.filter((_, i) => !skip.has(i)),
    };
}
