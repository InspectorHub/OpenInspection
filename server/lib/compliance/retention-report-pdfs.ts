/**
 * One of the two retention executors that reach outside D1.
 *
 * Every other rule is a `db.delete(...)` against one store and lives in
 * `retention-executors.ts`. This one is here because it is a different KIND of
 * operation, not because the other file was long: the row points at an R2
 * object, so two stores have to agree, and the order they are touched in is a
 * correctness property rather than a detail. The intake rule
 * (`retention-migration-batches.ts`) is here for the same reason.
 *
 * It is also the only rule whose window is per-tenant, which is why it takes
 * `now` from the context and computes its own cutoffs instead of using the one
 * the sweep precomputed from the manifest.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { reportPdfs, reportVersions, tenantConfigs } from '../db/schema';
import { changeCount, subtractMonthsMs } from './db-row-utils';
import { resolveReportPdfRetentionYears } from './report-pdf-retention';
import type { Executor } from './retention-executor-context';

/**
 * The one executor that touches R2.
 *
 * Order is not an implementation detail: the OBJECT goes first, then the
 * row. Reversed, a failure between the two leaves an object no row points
 * at — unreachable by this sweep, by the tenant purge, and by any future
 * cleanup, because the key lived only on the row. This way a failure leaves
 * a row whose object is already gone, which the next sweep retries
 * harmlessly (deleting an absent R2 key is a no-op).
 *
 * The per-tenant window is resolved per tenant rather than per row: one
 * config read per distinct tenant, not one per PDF.
 */
export const reportPdfsExecutor: Executor = async (rawDb, _cutoff, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const rows = await db.select({
        id: reportPdfs.id,
        tenantId: reportPdfs.tenantId,
        inspectionId: reportPdfs.inspectionId,
        r2Key: reportPdfs.r2Key,
        renderedAt: reportPdfs.renderedAt,
    }).from(reportPdfs).all();
    if (rows.length === 0) return 0;

    const tenantIds: string[] = [...new Set((rows as { tenantId: string }[]).map((r) => r.tenantId))];
    const configs = await db.select({
        tenantId: tenantConfigs.tenantId,
        years: tenantConfigs.reportPdfRetentionYears,
    }).from(tenantConfigs).where(inArray(tenantConfigs.tenantId, tenantIds)).all();
    const byTenant = new Map<string, number>(
        configs.map((c: { tenantId: string; years: number | null }) => [
            c.tenantId, resolveReportPdfRetentionYears({ reportPdfRetentionYears: c.years }),
        ]),
    );

    let doomed: { id: string; tenantId: string; inspectionId: string; r2Key: string }[] = [];
    for (const r of rows as { id: string; tenantId: string; inspectionId: string; r2Key: string; renderedAt: Date | number }[]) {
        // A tenant with no config row gets the disclosed default, NOT
        // indefinite. Reading a missing row as 0 would silently convert
        // every silent tenant to the opposite of the stated default.
        const years = byTenant.get(r.tenantId) ?? resolveReportPdfRetentionYears(null);
        if (years === 0) continue;  // indefinite — a controller instruction
        // Legal hold outranks the window. This rule filters in
        // JS rather than SQL because its window is per-tenant, so the exclusion
        // goes here rather than through `notHeld` — same invariant, and the only
        // place in this file where a tenant is decided about.
        if (ctx.heldTenantIds.has(r.tenantId)) continue;
        const cutoff = subtractMonthsMs(ctx.now, years * 12);
        const rendered = r.renderedAt instanceof Date ? r.renderedAt.getTime() : Number(r.renderedAt);
        if (rendered < cutoff) doomed.push({ id: r.id, tenantId: r.tenantId, inspectionId: r.inspectionId, r2Key: r.r2Key });
    }
    if (doomed.length === 0) return 0;

    // A PDF of a published report is never destroyed by this window, whatever the tenant chose: the client was given that report, and
    // the file is what they download. "Published" here is any inspection that has a version on record, so the unversioned renders
    // taken of it afterwards are kept too. Only the PDFs of reports that were never published expire. Looked up per tenant and in
    // small groups, because D1 caps the number of bound values in one statement.
    const published = new Set<string>();
    const byTenantInspections = new Map<string, Set<string>>();
    for (const d of doomed) {
        const set = byTenantInspections.get(d.tenantId) ?? new Set<string>();
        set.add(d.inspectionId);
        byTenantInspections.set(d.tenantId, set);
    }
    for (const [tenantId, inspectionSet] of byTenantInspections) {
        const ids = [...inspectionSet];
        for (let i = 0; i < ids.length; i += 40) {
            const versioned = await db.select({ inspectionId: reportVersions.inspectionId })
                .from(reportVersions)
                .where(and(eq(reportVersions.tenantId, tenantId), inArray(reportVersions.inspectionId, ids.slice(i, i + 40))))
                .all();
            for (const v of versioned as { inspectionId: string }[]) published.add(`${tenantId}/${v.inspectionId}`);
        }
    }
    doomed = doomed.filter((d) => !published.has(`${d.tenantId}/${d.inspectionId}`));
    if (doomed.length === 0) return 0;

    // The bucket is demanded HERE, not on entry, and the difference matters:
    // a deployment with no expired PDFs must not have its whole sweep
    // refused over a binding it never needed. The refusal fires only when
    // there is something this executor would otherwise half-delete.
    const bucket = ctx.stores.photos;
    if (!bucket) {
        throw new Error(
            'report_pdfs retention needs the photos bucket — refusing to delete rows that '
            + 'point at objects nothing else can reach. Pass { photos } to runLogRetentionSweep.',
        );
    }

    // Objects first. A throw here leaves every row intact. A queued render that never produced a file is a placeholder row with an
    // empty key: it names no object, so it is not handed to storage (an empty key is not a key). Storage takes at most 1000 keys
    // per call and D1 caps the values bound in one statement, so both deletes go in groups.
    const withFiles = doomed.filter((d) => d.r2Key !== '');
    for (let i = 0; i < withFiles.length; i += 500) await bucket.delete(withFiles.slice(i, i + 500).map((d) => d.r2Key));
    let removed = 0;
    for (let i = 0; i < doomed.length; i += 50) {
        const res = await db.delete(reportPdfs)
            .where(inArray(reportPdfs.id, doomed.slice(i, i + 50).map((d) => d.id)))
            .run();
        removed += changeCount(res);
    }
    return removed;
};
