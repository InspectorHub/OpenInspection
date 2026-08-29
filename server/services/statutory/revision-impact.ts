/**
 * How big a problem one revision is, when the revision turns out to be a
 * problem.
 *
 * ── THE QUESTION A RECALL ACTUALLY STARTS WITH ──────────────────────────────
 * Two faults end here, and they are not the same fault: our field map was found
 * to be wrong, or the authority withdrew the revision. What a workspace is told
 * differs. What a platform operator needs first is identical, and it is a
 * number: how many official documents were produced from this revision, and by
 * whom. Everything after that — whether to withdraw, what to write, how urgent
 * it is — is a judgement made on top of that number.
 *
 * ── WHY IT COUNTS DOCUMENTS, NOT INSPECTIONS ────────────────────────────────
 * A re-issue is a second delivery: the same inspection can have put two copies
 * of the same wrong document into two different sets of hands. Counting
 * inspections would report the smaller, more comfortable number, and the whole
 * point of `statutory_form_productions` — one row per production, never an
 * upsert — is that the larger one is the true one. Both are returned so the
 * difference between them is visible rather than lost in a choice.
 *
 * ── WHY IT DOES NOT READ INSTALLS ───────────────────────────────────────────
 * A workspace that has since uninstalled still produced whatever it produced.
 * Answering this from `tenant_library_imports` would omit exactly those, which
 * is the reading that looks reassuring and is wrong.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { and, eq } from 'drizzle-orm';
import { statutoryFormProductions } from '../../lib/db/schema';
import type { StatutoryFormVersion } from '../../lib/statutory/form-registry';

type Db = DrizzleD1Database<Record<string, unknown>>;

export interface RevisionImpact {
    formId: string;
    version: string;
    /**
     * Whether this software still publishes the revision.
     *
     * `false` is not the same as "not withdrawn", and the two must not collapse
     * into one silence: `lint:statutory-additive` forbids a revision
     * disappearing precisely so that a false here means somebody removed one,
     * and the reports produced from it can no longer be re-issued.
     */
    publishedRevision: boolean;
    /** When new production stopped, or null. Meaningless when not published. */
    withdrawnAt: number | null;
    /** Documents produced. The recall number. */
    productions: number;
    /** Workspaces that produced at least one. Who has to be told. */
    tenants: number;
    /** Inspections involved. Always ≤ productions; a re-issue is a second one. */
    inspections: number;
    firstProducedAt: number | null;
    lastProducedAt: number | null;
}

export async function revisionImpact(
    db: Db,
    formId: string,
    version: string,
    versions: readonly StatutoryFormVersion[],
): Promise<RevisionImpact> {
    const published = versions.find((v) => v.formId === formId && v.version === version);

    const rows = await db
        .select({
            tenantId: statutoryFormProductions.tenantId,
            inspectionId: statutoryFormProductions.inspectionId,
            producedAt: statutoryFormProductions.producedAt,
        })
        .from(statutoryFormProductions)
        .where(and(
            eq(statutoryFormProductions.formId, formId),
            eq(statutoryFormProductions.version, version),
        ))
        .all();

    const tenants = new Set<string>();
    const inspections = new Set<string>();
    let first: number | null = null;
    let last: number | null = null;
    for (const row of rows) {
        tenants.add(row.tenantId);
        // Scoped by tenant as well: two workspaces are free to hold inspections
        // with the same id, and collapsing them would under-report.
        inspections.add(`${row.tenantId} ${row.inspectionId}`);
        const at = row.producedAt === null ? null : new Date(row.producedAt).getTime();
        if (at === null) continue;
        if (first === null || at < first) first = at;
        if (last === null || at > last) last = at;
    }

    return {
        formId,
        version,
        publishedRevision: published !== undefined,
        withdrawnAt: published?.withdrawnAt ?? null,
        productions: rows.length,
        tenants: tenants.size,
        inspections: inspections.size,
        firstProducedAt: first,
        lastProducedAt: last,
    };
}
