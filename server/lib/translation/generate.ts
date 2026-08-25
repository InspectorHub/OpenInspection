/**
 * #23 — producing a courtesy translation of one report, end to end.
 *
 *     resolve report id -> getReportData -> segmentReport -> translateSegments
 *                                                              -> store
 *
 * Storage, the notice constant, the response-length invariant and the
 * capability posture all shipped before anything called them. This is the
 * caller. Until it existed the feature was a table.
 *
 * ## The rules this function is the enforcement of
 *
 *  - **Only `segmentReport` decides what a model sees.** The provider is handed
 *    an already-segmented list and cannot obtain the report, so no adapter —
 *    present or future — can widen what gets machine-translated.
 *  - **Nothing else calls the translate chokepoint.** Asserted in
 *    `tests/unit/translation/segment-report.spec.ts` over the whole tree.
 *  - **The English hash is taken at production time and passed in.** Not
 *    recomputed at storage time: recomputing would hash a report that may have
 *    moved in between, and the row would claim a provenance the translation
 *    does not have. The hash is the ENGLISH-only one — no translation identity
 *    in the basis, or it would be circular.
 *  - **A refusal is a refusal.** Nothing here catches a credential refusal and
 *    retries on other credentials. A workspace told the platform key does not
 *    serve this capability must not then be billed on their own.
 *
 * ## Metering rides the existing chokepoint
 *
 * `translateSegments` already passes `'translate'` to the meter. There is no
 * second counter here, and a platform-allowance check is not repeated either —
 * both live inside the chokepoint, where the resolved credential source is
 * known.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { AIService } from '../../services/ai.service';
import type { InspectionService } from '../../services/inspection.service';
import type { ReportTranslationService } from '../../services/report-translation.service';
import { resolveRenderedReportId } from '../../services/inspection/report-grain';
import { segmentReport } from './segment-report';
import { Errors } from '../errors';

export interface GenerateCourtesyTranslationDeps {
    db: D1Database;
    ai: AIService;
    inspection: InspectionService;
    translations: ReportTranslationService;
}

export interface GenerateCourtesyTranslationInput {
    tenantId: string;
    inspectionId: string;
    /** Which deliverable. Absent = the primary report. */
    reportId?: string;
    /** BCP-47 target, e.g. `es-419`. */
    locale: string;
    /**
     * Building-terminology term map, English term to the approved target term.
     * Empty is legitimate — it means no term is pinned, not that the glossary
     * was forgotten.
     */
    glossary?: Record<string, string>;
}

export interface GenerateCourtesyTranslationResult {
    reportId: string;
    locale: string;
    /** How many spans were sent and stored. Equal by construction. */
    segmentCount: number;
    englishHash: string;
}

export async function generateCourtesyTranslation(
    deps: GenerateCourtesyTranslationDeps,
    input: GenerateCourtesyTranslationInput,
): Promise<GenerateCourtesyTranslationResult> {
    const { tenantId, inspectionId, locale } = input;

    const reportId = await resolveRenderedReportId(
        drizzle(deps.db), tenantId, inspectionId, input.reportId,
    );
    if (!reportId) {
        // A translation is OF a document. Without a `reports` row there is no
        // identity to key one to, and inventing one would produce a row no
        // reader could ever find.
        throw Errors.NotFound('This inspection has no report to translate.');
    }

    const data = await deps.inspection.getReportData(
        inspectionId, tenantId, (key: string) => key, undefined, undefined, reportId,
    );

    const spans = segmentReport(data);
    if (spans.length === 0) {
        // Refused rather than stored empty. An empty translation and a report
        // with nothing to translate produce the same row, and the second is not
        // a thing a reader should ever be shown a notice about.
        throw Errors.BadRequest('This report has no translatable content yet.');
    }

    // The hash of the ENGLISH this translation is made from, taken BEFORE the
    // call. `readFresh` compares a reader's current English against this exact
    // value, so it must carry no translation identity of its own.
    const englishHash = await deps.inspection.getReportContentHash(inspectionId, tenantId, reportId);

    // ⚠️ The ONLY call to the translate chokepoint. `context` is deliberately
    // omitted: these spans come from the whole report, so no single part names
    // them, and the prompt interface carries nothing else — no address, no
    // client, no inspector. Widening it reaches forbidden content without
    // touching this function.
    const { segments, aiCallId, source } = await deps.ai.translateSegments({
        segments: spans.map((s) => s.text),
        targetLocale: locale,
        glossary: input.glossary ?? {},
    });

    await deps.translations.store(tenantId, reportId, locale, {
        segments, source, englishHash, aiCallId,
    });

    return { reportId, locale, segmentCount: segments.length, englishHash };
}

/**
 * Take a translation down.
 *
 * Available even where production is switched off: cleaning up after turning
 * the feature off is exactly when it is needed. Returns whether a row was
 * actually removed, so a caller can tell "removed" from "there was nothing to
 * remove" — the second is not an error and must not be reported as success at
 * doing something.
 */
export async function removeCourtesyTranslation(
    deps: Pick<GenerateCourtesyTranslationDeps, 'db' | 'translations'>,
    input: { tenantId: string; inspectionId: string; reportId?: string; locale: string },
): Promise<{ reportId: string | null; removed: boolean }> {
    const reportId = await resolveRenderedReportId(
        drizzle(deps.db), input.tenantId, input.inspectionId, input.reportId,
    );
    if (!reportId) return { reportId: null, removed: false };
    return {
        reportId,
        removed: await deps.translations.remove(input.tenantId, reportId, input.locale),
    };
}
