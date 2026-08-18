/**
 * The one retention executor that reaches outside D1.
 *
 * Every other rule is a `db.delete(...)` and lives in `retention-executors.ts`.
 * This one is here because it is a different KIND of operation, not because the
 * other file was long: the row points at an R2 object, so two stores have to
 * agree, and the order they are touched in is a correctness property rather
 * than a detail.
 *
 * It is also the only rule whose window is per-tenant, which is why it takes
 * `now` from the context and computes its own cutoffs instead of using the one
 * the sweep precomputed from the manifest.
 */
import { inArray } from 'drizzle-orm';
import { reportPdfs, tenantConfigs } from '../db/schema';
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

    const doomed: { id: string; r2Key: string }[] = [];
    for (const r of rows as { id: string; tenantId: string; r2Key: string; renderedAt: Date | number }[]) {
        // A tenant with no config row gets the disclosed default, NOT
        // indefinite. Reading a missing row as 0 would silently convert
        // every silent tenant to the opposite of the stated default.
        const years = byTenant.get(r.tenantId) ?? resolveReportPdfRetentionYears(null);
        if (years === 0) continue;  // indefinite — a controller instruction
        // Legal hold outranks the window (review review). This rule filters in
        // JS rather than SQL because its window is per-tenant, so the exclusion
        // goes here rather than through `notHeld` — same invariant, and the only
        // place in this file where a tenant is decided about.
        if (ctx.heldTenantIds.has(r.tenantId)) continue;
        const cutoff = subtractMonthsMs(ctx.now, years * 12);
        const rendered = r.renderedAt instanceof Date ? r.renderedAt.getTime() : Number(r.renderedAt);
        if (rendered < cutoff) doomed.push({ id: r.id, r2Key: r.r2Key });
    }
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

    // Objects first. A throw here leaves every row intact.
    await bucket.delete(doomed.map((d) => d.r2Key));
    const res = await db.delete(reportPdfs)
        .where(inArray(reportPdfs.id, doomed.map((d) => d.id)))
        .run();
    return changeCount(res);
};
