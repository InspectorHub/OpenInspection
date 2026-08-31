/**
 * Seed the GLOBAL marketplace catalogue.
 *
 * Extracted from `starter-content.service.ts` because it is the one block with
 * no tenant: `marketplace_libraries` has no `tenant_id` at all. Every other
 * block there answers "what does this new workspace get"; this one answers
 * "what does this deployment offer", and running it per tenant is only how it
 * gets a chance to run at all.
 */
import { eq } from 'drizzle-orm';
import { marketplaceLibraries } from '../../lib/db/schema';
import { MARKETPLACE_LIBRARIES } from './fixtures/marketplace';
import { batchInsert } from './batch-insert';

/**
 * Bring the catalogue up to what this release ships.
 *
 * ⚠️ UPSERT, NOT INSERT-IF-MISSING. This is the only writer of what a pack
 * CONTAINS, so it is also the only path a repository change has into a
 * deployment that already holds the row. Filtering by name and inserting only
 * the missing ones meant bumping a pack's semver here never reached one — and
 * the "update available" badge is an equality test against that column, so the
 * update path was unreachable from the repository side, for every kind.
 *
 * The split of authority is deliberate: the repository is authoritative for
 * what a pack contains, the ROW is authoritative for its identity and its
 * history. Rewriting `id` would orphan every `tenant_library_imports.libraryId`
 * pointing at it; rewriting `downloadCount` would replace the tenants' own
 * history with a number from source control.
 *
 * @returns rows created PLUS rows refreshed (zero when the deployment already
 *   matches this release).
 */
export async function seedMarketplaceLibraries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: any,
    now: Date = new Date(),
): Promise<number> {
    const existing = await d.select({
        id:     marketplaceLibraries.id,
        name:   marketplaceLibraries.name,
        semver: marketplaceLibraries.semver,
    }).from(marketplaceLibraries).all();
    const byName = new Map<string, { id: string; name: string; semver: string }>(
        existing.map((r: { id: string; name: string; semver: string }) => [r.name, r]),
    );

    const rows = MARKETPLACE_LIBRARIES.filter(lib => !byName.has(lib.name)).map(lib => ({
        id:            crypto.randomUUID(),
        name:          lib.name,
        kind:          lib.kind,
        semver:        lib.semver,
        schema:        lib.schema,
        authorId:      'system',
        changelog:     lib.changelog,
        downloadCount: 0,
        featured:      lib.featured,
        // Absent on a pack written for everybody, which is most of them. The
        // column is nullable for exactly that reason.
        jurisdiction:  lib.jurisdiction ?? null,
        createdAt:     now,
        updatedAt:     now,
    }));
    await batchInsert(d, marketplaceLibraries, rows);

    // Only rows whose semver actually moved. Refreshing unconditionally would
    // rewrite `updated_at` on every deployment, which is the column a reader
    // would reach for to ask when a pack last changed.
    let refreshed = 0;
    for (const lib of MARKETPLACE_LIBRARIES) {
        const row = byName.get(lib.name);
        if (!row || row.semver === lib.semver) continue;
        await d.update(marketplaceLibraries).set({
            semver:    lib.semver,
            schema:    lib.schema,
            changelog: lib.changelog,
            featured:  lib.featured,
            // Refreshed with the rest of the content: a pack that changes which
            // jurisdiction it is written for and keeps the old label is worse
            // than one that never carried a label at all.
            jurisdiction: lib.jurisdiction ?? null,
            updatedAt: now,
        }).where(eq(marketplaceLibraries.id, row.id));
        refreshed += 1;
    }

    return rows.length + refreshed;
}
