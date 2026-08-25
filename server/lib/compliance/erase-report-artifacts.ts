/**
 * Erasure executor for what a DELIVERED REPORT leaves behind: the record that
 * the subject viewed it, and the courtesy translation of it.
 *
 * Why this lives outside `erasure-orchestrator.ts`: that file is at its
 * anti-monolith line cap, and these are two self-contained steps about one
 * subject. Both are registered through the orchestrator's `step()` recorder, so
 * their decisions land in the same append-only `erasure_log` row as every other
 * step and a throw here flips the run to `partially_completed` like any other.
 *
 * ⚠️ ORDER IS BEHAVIOUR, in both directions.
 *
 *  - `report_views` must be deleted BEFORE `inspection_access_tokens`.
 *    `access_token_id` is the only locator back to the subject (there is no
 *    email on that table), so dropping the tokens first strands those rows
 *    permanently — for this pass and every later one.
 *  - `report_translations` must be deleted BEFORE the `reports` step clears the
 *    title, or not — it does not matter, because it is located through
 *    `reports.inspection_id` and the ROW survives that step. Said out loud so
 *    the next reader does not have to work it out: the reports step erases
 *    columns in place and never removes the spine.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { inspectionAccessTokens, reportViews, reports, reportTranslations } from '../db/schema';
import { changeCount } from './db-row-utils';

/**
 * The orchestrator's fail-closed step recorder. Passed in rather than imported
 * so this module cannot write to the decision log behind the orchestrator's
 * back, and so the counts it produces are aggregated exactly like the rest.
 */
type StepRecorder = (
    table: string,
    action: 'delete' | 'null' | 'erase_in_place',
    extra: { legalBasis?: 'art_17_3_b' | 'art_17_3_e'; retentionExpiry?: number },
    fn: () => Promise<number>,
) => Promise<void>;

export interface EraseReportArtifactsInput {
    tenantId: string;
    subjectEmail: string;
    /** Inspection ids the subject is a person on (via `inspection_people`). */
    inspectionIds: string[];
    step: StepRecorder;
}

/**
 * Delivery counters, keyed on the subject's access tokens.
 *
 * Zeroing them is not an option: an all-zero row still asserts that this person
 * was sent this document.
 */
export async function eraseReportViews(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    { tenantId, subjectEmail, step }: EraseReportArtifactsInput,
): Promise<void> {
    const tokRows = await db.select({ id: inspectionAccessTokens.id }).from(inspectionAccessTokens)
        .where(and(
            eq(inspectionAccessTokens.tenantId, tenantId),
            eq(inspectionAccessTokens.recipientEmail, subjectEmail),
        ))
        .all();
    const tokIds = (tokRows as Array<{ id: string }>).map((t) => t.id);
    await step('report_views', 'delete', {}, async () => tokIds.length === 0 ? 0 : changeCount(
        await db.delete(reportViews)
            .where(and(eq(reportViews.tenantId, tenantId), inArray(reportViews.accessTokenId, tokIds)))
            .run()));
}

/**
 * The courtesy translations of the subject's reports.
 *
 * DELETED, not erased in place, and the choice is worth stating because both
 * are defensible. The row doubles as the opt-in record — no row means never
 * translated, a row whose hash matches means live, a row whose hash does not
 * means previously translated and currently withheld — so deleting it converts
 * the third state into the first. That is the right conversion: once the
 * English the translation described has been erased around it, "never
 * translated" is the state the report is genuinely in. A workflow convenience
 * is not a reason to keep a derived copy of a subject's data through their
 * erasure request.
 *
 * Located through `reports.inspection_id`, the same route the `reports` step
 * uses, because `report_translations` carries no identifier of a person at all
 * — which is also why the PII heuristic could never have found this table.
 */
export async function eraseReportTranslations(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    { tenantId, inspectionIds, step }: EraseReportArtifactsInput,
): Promise<void> {
    await step('report_translations', 'delete', {}, async () => {
        if (inspectionIds.length === 0) return 0;
        const reportRows = await db.select({ id: reports.id }).from(reports)
            .where(and(eq(reports.tenantId, tenantId), inArray(reports.inspectionId, inspectionIds)))
            .all();
        const reportIds = (reportRows as Array<{ id: string }>).map((r) => r.id);
        if (reportIds.length === 0) return 0;
        return changeCount(await db.delete(reportTranslations)
            .where(and(
                eq(reportTranslations.tenantId, tenantId),
                inArray(reportTranslations.reportId, reportIds),
            ))
            .run());
    });
}
