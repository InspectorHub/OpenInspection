/**
 * What the catalogue's import markers say about a workspace's local templates.
 *
 * Two facts come out of one small table, and both are things the template list
 * has to report:
 *
 *   - which local rows came from the catalogue, and from which entry;
 *   - which retired rows were retired by an UNINSTALL rather than by an update;
 *   - which jurisdiction the entry a row came from is written to, if any.
 *
 * ── THE RETIREMENT REASON IS DERIVED, NOT STORED ────────────────────────────
 * An update mints a new local row and re-points the marker at it, so the row it
 * replaced ends up named by no marker at all. An uninstall leaves the marker
 * naming the same row and stamps `uninstalled_at` on it. That difference is
 * already unambiguous, and a column recording the reason would be a third copy
 * of the same fact — the one that goes stale first, because nothing would fail
 * when a path forgot to write it.
 *
 * ── WHY THE DIFFERENCE IS WORTH TELLING A READER ────────────────────────────
 * They differ in what anybody can do about them. "Replaced by a newer revision"
 * is nothing to act on; "uninstalled" is something an administrator can undo.
 * One word for both would tell a reader neither.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { eq } from 'drizzle-orm';
import { marketplaceLibraries, tenantLibraryImports } from '../../lib/db/schema/marketplace';

/** Whatever `drizzle(env.DB)` this caller holds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzle = DrizzleD1Database<any>;

export interface ImportMarkers {
    /** local template id -> the catalogue entry it came from. */
    catalogIdByLocalId: Map<string, string>;
    /** local template ids whose marker carries an uninstall stamp. */
    uninstalledLocalIds: Set<string>;
    /**
     * local template id -> the jurisdiction its catalogue entry is written to.
     *
     * Only rows whose entry names one appear here. A template a workspace
     * authored itself names no entry and is general by definition, so its
     * absence from this map IS the answer rather than a missing lookup.
     *
     * Read for ORDERING, not for gating: it decides which template the New
     * Inspection picker offers first (`app/lib/template-order.ts`), so a
     * workspace is never recommended another state's statutory form.
     */
    jurisdictionByLocalId: Map<string, string>;
}

/**
 * `local_entity_id` names the ONE local row a 1:1 import produced; a 1:N import
 * leaves it null and is tracked by `row_count` instead, so those markers simply
 * never match a template id.
 */
export async function readImportMarkers(
    db: AnyDrizzle,
    tenantId: string,
): Promise<ImportMarkers> {
    // LEFT join, not inner: a marker whose catalogue entry has been delisted —
    // or is somehow missing — must still report which local row it produced.
    // Losing the import marker would make a catalogue template read as one the
    // workspace authored, which is a bigger lie than an unknown jurisdiction.
    const rows = await db.select({
        localEntityId: tenantLibraryImports.localEntityId,
        libraryId:     tenantLibraryImports.libraryId,
        uninstalledAt: tenantLibraryImports.uninstalledAt,
        jurisdiction:  marketplaceLibraries.jurisdiction,
    })
        .from(tenantLibraryImports)
        .leftJoin(marketplaceLibraries, eq(marketplaceLibraries.id, tenantLibraryImports.libraryId))
        .where(eq(tenantLibraryImports.tenantId, tenantId))
        .all();

    const catalogIdByLocalId = new Map<string, string>();
    const uninstalledLocalIds = new Set<string>();
    const jurisdictionByLocalId = new Map<string, string>();
    for (const row of rows) {
        if (!row.localEntityId) continue;
        catalogIdByLocalId.set(row.localEntityId as string, row.libraryId as string);
        if (row.uninstalledAt !== null) uninstalledLocalIds.add(row.localEntityId as string);
        const jurisdiction = (row.jurisdiction as string | null)?.trim();
        if (jurisdiction) jurisdictionByLocalId.set(row.localEntityId as string, jurisdiction);
    }
    return { catalogIdByLocalId, uninstalledLocalIds, jurisdictionByLocalId };
}

export interface TemplateRetirement {
    /** When it stopped being offered for new inspections, epoch ms, or null. */
    retiredAt: number | null;
    /** Why it stopped, or null while it is still on offer. */
    retiredReason: 'superseded' | 'uninstalled' | null;
}

/**
 * How one template's retirement should be described to a reader.
 *
 * Retired rows STAY in the list they are read for. A template that simply
 * vanishes is more unsettling than one that leaves with a reason: the reader's
 * first conclusion is that their permissions changed or that the product broke.
 */
export function retirementOf(
    retiredAt: Date | number | null,
    wasUninstalled: boolean,
): TemplateRetirement {
    if (retiredAt === null) return { retiredAt: null, retiredReason: null };
    return {
        retiredAt: new Date(retiredAt).getTime(),
        retiredReason: wasUninstalled ? 'uninstalled' : 'superseded',
    };
}
