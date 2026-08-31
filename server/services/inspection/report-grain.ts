/**
 * Which document is being rendered, and what its render inputs hash to.
 *
 * Extracted from `inspection-report.service.ts`, where the answer to "which
 * results row is this" was never actually given: the service selected
 * `inspection_results` by `(inspectionId, tenantId)` and took the first row,
 * while `inspection_results.report_id` carries a unique index. One inspection
 * can deliver several reports — a standard one and a radon one — so that
 * `.get()` returned whichever the driver handed over first, and every hash
 * consumer inherited the coin flip.
 *
 * Kept in its own module rather than left in that service for two reasons, and
 * neither is tidiness: the service sits at its large-file cap with no headroom,
 * and which results row a render is reading is the one decision in the render
 * path that a reader should be able to find without walking nine hundred lines
 * of payload assembly.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults, reports } from '../../lib/db/schema';
import { sha256Hex } from '../../lib/sha256';
import { RENDER_VERSION } from '../../lib/pdf';

/** Any drizzle handle the render path holds. Structural, so tests can pass theirs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = DrizzleD1Database<any>;

/**
 * The stored translation a render is presenting, reduced to the only two facts
 * that change a rendered byte.
 *
 * ⚠️ NOT the provider, and NOT the credential source. A translation is produced
 * once and stored; the backend that produced it changes nothing anyone sees.
 * Putting the source in the basis would invalidate every published PDF the
 * moment a workspace changed an AI setting, and re-render each one from the
 * same stored translation to byte-identical output.
 */
export interface TranslationIdentity {
    locale: string;
    /** `report_translations.translated_hash` — the stored bytes, not the row id. */
    translatedHash: string;
}

/**
 * Resolve the `reports` row a render is for.
 *
 * An ABSENT `reportId` means the PRIMARY report, which is what every caller
 * predating the reports entity meant and still means. Say that out loud rather
 * than leaving it implied: a silent default here would be the same defect in a
 * new place. It is well-defined rather than conventional, because
 * `uq_reports_primary` is a partial unique index over `kind = 'primary'`, so an
 * inspection has at most one.
 *
 * Returns `null` when the inspection has no `reports` row at all — a
 * pre-reports inspection, or one mid-backfill. Callers fall back to the
 * inspection grain there, which is exactly what they did before this existed.
 */
export async function resolveRenderedReportId(
    db: Db,
    tenantId: string,
    inspectionId: string,
    reportId?: string,
): Promise<string | null> {
    if (reportId) return reportId;
    const primary = await db
        .select({ id: reports.id })
        .from(reports)
        .where(and(
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
            eq(reports.kind, 'primary'),
        ))
        .get();
    return primary?.id ?? null;
}

/**
 * The `inspection_results` row for one rendered report.
 *
 * Two shapes are both correct, and the difference is a migration rather than a
 * bug:
 *
 *  - `report_id` set — the row for THAT report. Every row carries one once the
 *    backfill has run, and it is the only shape that can express an inspection
 *    delivering more than one document.
 *  - `report_id` NULL — a row written before reports existed. There is exactly
 *    one such row per inspection, so "the results for this inspection" is
 *    unambiguous and a report id is simply not part of the question.
 *
 * So a report-scoped read is tried first and an un-scoped row is the fallback.
 * The other order answers a multi-report inspection with a coin flip, which is
 * the behaviour this replaced.
 */
export async function resolveResultsRow(
    db: Db,
    tenantId: string,
    inspectionId: string,
    reportId: string | null,
) {
    if (reportId) {
        const scoped = await db
            .select()
            .from(inspectionResults)
            .where(and(
                eq(inspectionResults.tenantId, tenantId),
                eq(inspectionResults.inspectionId, inspectionId),
                eq(inspectionResults.reportId, reportId),
            ))
            .get();
        if (scoped) return scoped;
        // Named a report and found no row for it. Fall back ONLY to a row that
        // claims no report — never to another report's row, which is how a
        // radon report would come to render the standard report's findings.
        return db
            .select()
            .from(inspectionResults)
            .where(and(
                eq(inspectionResults.tenantId, tenantId),
                eq(inspectionResults.inspectionId, inspectionId),
                isNull(inspectionResults.reportId),
            ))
            .get();
    }
    return db
        .select()
        .from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
        ))
        .get();
}

/**
 * A stable content hash over the render inputs for a report.
 *
 * Used to skip Browser Rendering when an identical PDF is already cached, and
 * as the freshness basis a stored courtesy translation is checked against.
 *
 * Photo URLs use the raw R2 key (no volatile render/auth token) so the hash is
 * stable across token refreshes. Template CSS and layout changes are covered by
 * bumping `RENDER_VERSION`.
 *
 * Branding (logo image, primary colour) is NOT included: it is not part of the
 * report payload, and branding changes are covered by `RENDER_VERSION` too.
 *
 * ⚠️ This is NOT the report signature basis. `report_versions.content_hash` is
 * a digest over the publish SNAPSHOT and is what the Ed25519 signature covers
 * (`report-version.service.ts`); it is computed and stored independently. So a
 * change to what goes into the basis here re-renders cached PDFs once and
 * invalidates stored translation freshness — it cannot invalidate a signature.
 *
 * The translation identity is part of the basis because the same report
 * published English-only and then republished with a translation is two
 * different documents and must not share a cached PDF. Without it the second
 * read is served the first render, and the reverse is served the translated
 * one after the translation is removed.
 */
export async function reportContentHash(
    data: unknown,
    translation: TranslationIdentity | null = null,
): Promise<string> {
    // `'none'` rather than an omitted key: an absent field and a field holding
    // null serialise differently, and a basis whose SHAPE depends on a branch
    // is one refactor away from two documents hashing the same.
    const t = translation ? `${translation.locale}:${translation.translatedHash}` : 'none';
    return sha256Hex(JSON.stringify({ v: RENDER_VERSION, data, t }));
}
