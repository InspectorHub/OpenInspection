/**
 * Installing something this workspace had uninstalled.
 *
 * ── WHY THERE WAS NO WAY BACK IN ────────────────────────────────────────────
 * `importCatalogEntry` returned early on ANY existing marker, and an un-import
 * keeps its marker rather than deleting it — the row records which version the
 * workspace was on, and re-issuing a report produced back then needs it. So an
 * uninstall was permanent: the marker said "installed" to every reader, the
 * unique index on (tenant_id, library_id) left no second row to create, and the
 * template picker meanwhile told inspectors to ask an administrator to reinstall
 * something no administrator could. The schema promised in prose that
 * "reinstalling clears this and runs the update path"; nothing did either half.
 *
 * ── WHY IT IS A FILE AND NOT A METHOD ───────────────────────────────────────
 * The same reason `un-import.ts` and `local-template.ts` are: `marketplace.ts`
 * and its service are both at their size ceilings, and the halves of one verb
 * are easier to compare when each lives beside the others rather than inside a
 * class only one caller can reach.
 *
 * ── THE KINDS COME BACK DIFFERENTLY, BECAUSE THEY LEFT DIFFERENTLY ──────────
 * A 1:1 kind had its local row RETIRED and a 1:N kind had its rows DELETED, so
 * one returns by clearing a timestamp and the other by inserting the pack again.
 * There is no generic fallthrough here either: a kind that can be uninstalled
 * and not reinstalled is a one-way door nobody declared.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { eq, sql } from 'drizzle-orm';
import type { tenantLibraryImports } from '../../lib/db/schema/marketplace';
import { marketplaceLibraries } from '../../lib/db/schema/marketplace';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { insertLibraryComments } from './library-insert';
import { parseLibraryComments } from './library-pack';
import { insertLocalTemplate, retireLocalTemplate, unretireLocalTemplate } from './local-template';
import { assertStatutoryInstallable } from './statutory-import';
import { clearImportUninstalled } from './un-import';
import { writeImportHistory } from './import-history';

/** The service's `drizzle(env.DB)` handle. Named so this signature does not
 *  silently narrow to the schema-less default and reject its only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

export interface ReinstallInput {
    db: MarketplaceDb;
    /** The raw binding, for the comment insert path, which batches. */
    rawDb: D1Database;
    tenantId: string;
    /** Storage, for the statutory precondition. Absent fails that check closed. */
    bucket: R2Bucket | undefined;
    entry: typeof marketplaceLibraries.$inferSelect;
    existing: typeof tenantLibraryImports.$inferSelect;
    userId: string;
    /** The tenant-facing v2 validator, which only the service owns. */
    assertV2Schema: (schema: unknown) => void;
}

export async function reinstallCatalogEntry(input: ReinstallInput): Promise<{
    kind: 'comments' | 'templates' | 'statutory';
    localEntityId: string | null;
    rowCount: number;
}> {
    const { db, tenantId, entry, existing, userId } = input;
    const now = new Date();
    const sameVersion = existing.importedSemver === entry.semver;
    let rowCount = 0;
    let localEntityId = existing.localEntityId;

    if (entry.kind === 'statutory' || entry.kind === 'templates') {
        // Re-validated, and for a statutory pack the bytes are re-checked too. A
        // reinstall is an install: the catalogue row may have changed under the
        // workspace, and "it passed when you first installed it" is not a fact
        // about the row being written now.
        if (entry.kind === 'statutory') {
            await assertStatutoryInstallable(input.bucket, entry.schema, PUBLISHED_FORM_VERSIONS,
                { db: input.db, tenantId: input.tenantId });
        } else {
            input.assertV2Schema(entry.schema);
        }

        if (sameVersion && localEntityId !== null) {
            // Un-installing retired this row and destroyed nothing, so at the
            // same version reinstalling is that change in reverse. Minting a
            // second copy would leave the workspace holding two.
            await unretireLocalTemplate(db, tenantId, localEntityId);
        } else {
            // ⚠️ The catalogue moved on while the workspace was away. Restoring
            // what it left on would deliberately return a superseded statutory
            // revision to the picker, which is the trap `retired_at` exists to
            // close — so this takes the update path's shape instead.
            localEntityId = await insertLocalTemplate(
                db, tenantId, `${entry.name} (v${entry.semver})`, entry.schema, now,
            );
            await retireLocalTemplate(db, tenantId, existing.localEntityId, now);
        }
    } else if (entry.kind === 'comments') {
        // Its un-import DELETED the tagged rows, so there is nothing to un-hide:
        // the pack is inserted again, at whatever the catalogue offers now. Rows
        // the workspace wrote itself carry no library_id and were never in range
        // of either half.
        rowCount = await insertLibraryComments(
            input.rawDb, tenantId, entry.id, parseLibraryComments(entry.schema),
        );
    } else {
        throw new Error(`Catalogue kind '${String(entry.kind)}' has no reinstall path`);
    }

    await clearImportUninstalled(db, existing.id, now, {
        importedSemver: entry.semver,
        rowCount,
        localEntityId,
    });

    await db
        .update(marketplaceLibraries)
        .set({ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now })
        .where(eq(marketplaceLibraries.id, entry.id));

    await writeImportHistory(db, tenantId, {
        templateId:    localEntityId,
        libraryId:     entry.id,
        action:        'install',
        // The version it was on before it uninstalled. An install has nothing to
        // move from; a reinstall does, and a reader asking what happened to a
        // workspace across an absence needs both ends of it.
        sourceVersion: existing.importedSemver,
        targetVersion: entry.semver,
        rowsAffected:  localEntityId !== null ? 1 : rowCount,
        metadata:      { name: entry.name, kind: entry.kind, reinstall: true },
        userId,
    });

    return { kind: entry.kind, localEntityId, rowCount };
}
