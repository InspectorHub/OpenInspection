/**
 * What updating a statutory package costs the inspections already in flight.
 *
 * ── WHY THE CONFIRMATION NEEDS NUMBERS AND NOT A WARNING ────────────────────
 * Updating replaces the workspace's local template and retires the old one.
 * Inspections already under way stay on the retired one -- their snapshots
 * protect them -- and for most of them that is entirely fine: their dates fall
 * inside the superseded revision's window and their form goes out exactly as it
 * would have. A confirmation that said only "this affects work in progress"
 * would put an administrator off an update they should make.
 *
 * So two numbers, and the reassuring one is not optional: how many keep
 * producing correctly, and how many are dated under the newer revision and
 * therefore cannot produce their form at all. The second group's way out is a
 * new inspection on the updated template -- there is no migration.
 *
 * ── SAME CRITERION AS EVERYWHERE ELSE ───────────────────────────────────────
 * `revisionStatusForInspection`, the call the editor banner and the reschedule
 * response also make. A confirmation that counted by its own rule would show a
 * number the banner disagrees with, on the same day, about the same inspection.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { and, eq, isNull, ne } from 'drizzle-orm';
import { inspections, templates } from '../../lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../lib/db/schema/marketplace';
import { revisionStatusForInspection } from '../../lib/statutory/revision-status';

/** The service's `drizzle(env.DB)` handle. Named so these signatures do not
 *  silently narrow to the schema-less default and reject their only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

export interface StatutoryUpdateImpact {
    /** Inspections still on the superseded template, cancelled ones excluded. */
    total: number;
    /** Of those, the ones whose date sits inside the installed revision's window. */
    producible: number;
    /** Of those, the ones dated under a newer revision. They cannot produce at all. */
    blocked: number;
    /** The revision the installed template produces, or null when it names none. */
    fromRevision: string | null;
    /** The revision the catalogue entry produces, or null when it names none. */
    toRevision: string | null;
}

const EMPTY: StatutoryUpdateImpact = {
    total: 0, producible: 0, blocked: 0, fromRevision: null, toRevision: null,
};

/** The revision a template schema declares it was built for, if it declares one. */
function revisionOf(schema: unknown): string | null {
    const declared = (schema as { statutoryForm?: { revision?: unknown } } | null)
        ?.statutoryForm?.revision;
    return typeof declared === 'string' ? declared : null;
}

export async function statutoryUpdateImpact(
    db: MarketplaceDb,
    tenantId: string,
    libraryId: string,
    now: number = Date.now(),
): Promise<StatutoryUpdateImpact> {
    const entry = await db.select({ schema: marketplaceLibraries.schema })
        .from(marketplaceLibraries)
        .where(eq(marketplaceLibraries.id, libraryId))
        .get();
    if (!entry) return EMPTY;

    // An uninstalled import is not an update anybody is being asked about.
    const installed = await db.select({ localEntityId: tenantLibraryImports.localEntityId })
        .from(tenantLibraryImports)
        .where(and(
            eq(tenantLibraryImports.tenantId, tenantId),
            eq(tenantLibraryImports.libraryId, libraryId),
            isNull(tenantLibraryImports.uninstalledAt),
        ))
        .get();
    const localId = installed?.localEntityId ?? null;
    if (localId === null) return EMPTY;

    const local = await db.select({ schema: templates.schema })
        .from(templates)
        .where(and(eq(templates.id, localId), eq(templates.tenantId, tenantId)))
        .get();

    const fromRevision = revisionOf(local?.schema);
    const toRevision = revisionOf(entry.schema);

    // Cancelled inspections are excluded: one will never be delivered, so
    // counting it would overstate what this update costs, and the number's
    // whole job is to be the real cost.
    const rows = await db.select({
        date: inspections.date,
        templateSnapshot: inspections.templateSnapshot,
    })
        .from(inspections)
        .where(and(
            eq(inspections.tenantId, tenantId),
            eq(inspections.templateId, localId),
            ne(inspections.status, 'cancelled'),
        ))
        .all();

    let total = 0;
    let blocked = 0;
    for (const row of rows) {
        const status = revisionStatusForInspection({
            snapshot: row.templateSnapshot,
            inspectionDate: String(row.date ?? '').slice(0, 10),
            now,
        });
        // `null` is an inspection whose snapshot declares no statutory form (or
        // no revision). It is on this template but this update does not change
        // what it produces, so it is not part of the cost being reported.
        if (status === null) continue;
        total += 1;
        if (status.kind === 'cannot_produce') blocked += 1;
    }

    return { total, producible: total - blocked, blocked, fromRevision, toRevision };
}
