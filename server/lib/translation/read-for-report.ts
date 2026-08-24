/**
 * The READ side: what a reader is handed alongside an English report.
 *
 * Lives here rather than in `server/api/public-report.ts` because that route is
 * at its large-file cap — and because the rule this implements is not a routing
 * rule. It is the same rule the storage schema states, applied at the one
 * moment both hashes are in hand.
 *
 * ## Three invariants, and each is a test
 *
 *  1. **Never render a translation whose `english_hash` does not match.**
 *     Withhold it. A reader shown a translated finding the inspector has since
 *     corrected is worse off than a reader shown no translation at all, and the
 *     asymmetry is deliberate: withholding one that was in fact still accurate
 *     is visible and repairable, serving a stale one is silent and reaches the
 *     client.
 *  2. **The reader path reads stored rows ONLY. It never consults the tenant
 *     setting.** A loader that asked "is translation enabled for this
 *     workspace?" before showing the toggle would silently strip the
 *     translation from every report already delivered, the moment somebody
 *     changed a setting. Production is gated; consumption is not.
 *  3. **The segment count must still line up.** Segments are re-inserted
 *     POSITIONALLY, so a stored list that no longer matches the segmenter's
 *     output for this payload is refused rather than mapped. The hash check
 *     above should already have caught that, and this is the cheap second
 *     answer to the case where it did not — mapping translated prose onto the
 *     wrong components produces a document that reads correctly and describes
 *     the wrong house.
 *
 * ## The notice travels with it, and never through it
 *
 * Every payload carries the notice, resolved through the reviewed-constant
 * register. Nothing here can produce that text: it is the sentence that says
 * which document is the record, so it must not pass through the machinery it
 * describes.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { InspectionService } from '../../services/inspection.service';
import type { ReportTranslationService } from '../../services/report-translation.service';
import { resolveRenderedReportId } from '../../services/inspection/report-grain';
import { segmentReport, type ReportSpan } from './segment-report';
import type { ReportData } from './report-span-register';
import {
    COURTESY_TRANSLATION_NOTICE,
    courtesyTranslationNoticeFor,
} from '../legal/courtesy-translation-notice';

/** What a report page or a print template is handed. */
export interface CourtesyTranslationPayload {
    /** BCP-47 tag of the language the segments below are in. */
    locale: string;
    /**
     * The translated text, aligned index-for-index with `paths`.
     *
     * Both arrays are emitted rather than the segments alone, because a
     * renderer that had to re-derive the paths would be a second implementation
     * of the segmenter — and the two would drift on the day one changed.
     */
    segments: string[];
    /** Payload paths, e.g. `sections.3.items.2.notes`. */
    paths: string[];
    /**
     * The notice, in the language a reader should see it.
     *
     * `authoritative` is true when this wording IS the instrument in `locale` —
     * the English original, or a reviewed per-language constant. It is never
     * true of a machine translation.
     */
    notice: {
        locale: string;
        title: string;
        text: string;
        authoritative: boolean;
        /** The English notice version this translation was produced under. */
        version: number;
    };
    generatedAt: number;
}

export interface ReadTranslationDeps {
    db: D1Database;
    inspection: InspectionService;
    translations: ReportTranslationService;
}

export interface ReadTranslationInput {
    tenantId: string;
    inspectionId: string;
    /** Which deliverable. Absent = the primary report. */
    reportId?: string;
    locale: string;
    /**
     * The already-resolved report payload, so this does not build a second one.
     * The English half the reader is looking at.
     */
    data: ReportData;
}

/**
 * The translation to SHOW, or null.
 *
 * Null means "show the English only". It covers "there is none" and "there is
 * one and it no longer describes this document", because a reader has nothing
 * to do with the difference — the distinction belongs to the inspector, and it
 * is surfaced on their own surfaces rather than on the client's.
 */
export async function readCourtesyTranslationForReport(
    deps: ReadTranslationDeps,
    input: ReadTranslationInput,
): Promise<CourtesyTranslationPayload | null> {
    const reportId = await resolveRenderedReportId(
        drizzle(deps.db), input.tenantId, input.inspectionId, input.reportId,
    );
    if (!reportId) return null;

    // The CURRENT English, on the same basis the row recorded: no translation
    // identity in it, or the comparison would be circular.
    const currentEnglishHash = await deps.inspection.getReportContentHash(
        input.inspectionId, input.tenantId, reportId,
    );

    const stored = await deps.translations.readFresh(
        input.tenantId, reportId, input.locale, currentEnglishHash,
    );
    if (!stored) return null;

    const spans: ReportSpan[] = segmentReport(input.data);
    if (spans.length !== stored.segments.length) {
        // Should be unreachable: a matching hash means the render inputs are
        // byte-identical, so the segmenter's output is too. Refused anyway,
        // because the failure it would otherwise produce has no later detector
        // — no gate, no test of the rendered document, and no reader who does
        // not speak both languages would catch it.
        return null;
    }

    const notice = courtesyTranslationNoticeFor(input.locale);
    return {
        locale: stored.locale,
        segments: stored.segments,
        paths: spans.map((s) => s.path),
        notice: {
            locale: notice.locale,
            title: notice.title,
            text: notice.text,
            authoritative: notice.authoritative,
            version: COURTESY_TRANSLATION_NOTICE.version,
        },
        generatedAt: stored.generatedAt.getTime(),
    };
}
