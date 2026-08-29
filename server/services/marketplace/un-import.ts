/**
 * The un-import half.
 *
 * `marketplace_libraries` has required both halves since it was written —
 * "adding a kind means adding both halves; there is no generic fallthrough,
 * because a silent one is how the wrong table gets written" — and until now
 * neither kind had the second one. These are the pieces the service's
 * `uninstall` branches into; the branching itself stays there, in one readable
 * place, because that is what a reader adding a kind has to find.
 *
 * The two halves are genuinely different operations: retiring ONE local row is
 * not deleting N tagged ones, and a single branch pretending otherwise is how
 * one of them gets it wrong.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { and, eq } from 'drizzle-orm';
import { comments } from '../../lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../lib/db/schema/marketplace';
import { Errors } from '../../lib/errors';

/** The service's `drizzle(env.DB)` handle. Named so these signatures do not
 *  silently narrow to the schema-less default and reject their only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

/**
 * The catalogue row and this workspace's import marker, with the refusals an
 * un-import owes before it touches anything.
 *
 * Refusing a second uninstall is not tidiness: the un-import for the 1:N kind
 * deletes rows, and a second pass over a workspace that has since re-authored
 * its own comments would delete work nobody asked to lose.
 */
export async function resolveUninstall(
    db: MarketplaceDb,
    tenantId: string,
    libraryId: string,
) {
    // Unscoped by id alone, and correctly so: `marketplace_libraries` is the
    // published catalogue and carries no tenant_id — every workspace may read
    // every published entry. The tenant-specific half is the import row below,
    // and that one IS scoped.
    const [lib] = await db
        .select()
        .from(marketplaceLibraries)
        .where(eq(marketplaceLibraries.id, libraryId))
        .limit(1);
    if (!lib) throw Errors.NotFound('Marketplace entry not found');

    const [existing] = await db
        .select()
        .from(tenantLibraryImports)
        .where(and(
            eq(tenantLibraryImports.tenantId, tenantId),
            eq(tenantLibraryImports.libraryId, libraryId),
        ))
        .limit(1);
    if (!existing) throw Errors.BadRequest('Not installed — there is nothing to uninstall');
    if (existing.uninstalledAt !== null) throw Errors.BadRequest('Already uninstalled');

    return { lib, existing };
}

/**
 * Delete the comment rows one pack's import created for this workspace.
 *
 * Scoped by `library_id` as well as by tenant, so a workspace's OWN comments
 * (library_id IS NULL) and another pack's rows are never in range. Deleting is
 * right here and wrong for the 1:1 kinds: a comment row is a copy of a pack
 * entry with no other reader, where a template row is referenced by every
 * inspection that ever used it.
 */
export async function deleteLibraryComments(
    db: MarketplaceDb,
    tenantId: string,
    libraryId: string,
): Promise<number> {
    const rows = await db.delete(comments)
        .where(and(
            eq(comments.tenantId, tenantId),
            eq(comments.libraryId, libraryId),
        ))
        .returning({ id: comments.id });
    return rows.length;
}

/** Mark the import row uninstalled. The row itself is never deleted. */
export async function markImportUninstalled(
    db: MarketplaceDb,
    importId: string,
    at: Date,
): Promise<void> {
    await db.update(tenantLibraryImports)
        .set({ uninstalledAt: at })
        .where(eq(tenantLibraryImports.id, importId));
}
