/**
 * Commercial PCA Phase W Task 5 — the `.docx` export queue consumer. Batch
 * handler for the `WORD_EXPORT_QUEUE` producer (bound as
 * `openinspection-word-export`; see server/index.ts `queue` dispatch).
 *
 * Pipeline per message: parse envelope -> markBuilding -> getReportData
 * (identity photo-url mode) -> ADAPT the real report payload into the
 * `report-docx.ts` builder's input shape -> fetch + downscale appendix
 * photos SEQUENTIALLY (one at a time — never Promise.all over 50-100 photos,
 * see the plan's memory constraint) -> buildReportDocx -> R2 -> markReady.
 * On any throw: markFailed (status visible to the polling UI even if the
 * queue message is eventually dropped) + msg.retry with the SAME backoff
 * curve as server/portal/cmd-consumer.ts's handleCmdBatch; exhaustion is
 * governed by the consumer's `max_retries` (wrangler.jsonc) — no dedicated
 * word-export DLQ queue exists (see the plan report's deviations note).
 *
 * The consumer is NOT inside the JWT middleware — `tenantId`/`inspectionId`
 * come exclusively from the job envelope (server-written at enqueue time from
 * the JWT claim, never client input). Every D1/R2 read below stays scoped to
 * that tenantId.
 */
import { logger } from '../lib/logger';
import { r2Keys } from '../lib/r2-keys';
import { InspectionService } from './inspection.service';
import { ReportExportService } from './report-export.service';
import { BrandingService } from './branding.service';
import { buildReportDocx, type ReportDocxInput, type DocxAppendixPhoto, type DocxCostLine, type DocxReserveSchedule, type DocxSection, type DocxProfileRow } from '../lib/report-docx';
import { parseWordExportJob } from '../lib/sync-events/word-export-job';
import { sniffImageDimensions } from '../lib/media/image-dimensions';
import type { ImagesBinding } from '../lib/media/strip-exif';

/** Minimal binding surface the consumer needs, decoupled from the full
 *  Hono `AppEnv` (the queue handler runs outside request context). */
export interface WordExportConsumerEnv {
    DB: D1Database;
    PHOTOS: R2Bucket;
    TENANT_CACHE?: KVNamespace;
    KEY_ENCRYPTION_SECRET?: string;
    JWT_SECRET?: string;
    IMAGES?: ImagesBinding;
}

// Downscale target for embedded appendix photos — 2x the builder's
// PRINT_THUMB_WIDTH_PX (480) display bound, enough headroom for print
// fidelity without embedding full-resolution originals in the .docx.
const APPENDIX_PHOTO_DOWNSCALE_WIDTH_PX = 960;

// Hard ceiling on the total bytes embedded into one .docx Appendix B. `docx`'s
// `Packer.toBuffer` (report-docx.ts) is not streaming — it materializes the whole
// document, including every embedded image, as one in-memory buffer, so peak
// memory is ~2x the embedded bytes. When the IMAGES binding is present each photo
// is a ~200 KB downscaled JPEG and 50-100 photos fit comfortably. When it is
// absent (env.IMAGES unset — e.g. an account without Images Transformations
// enabled) photos embed at full resolution (2-4 MB each), and without a cap a
// large report would blow past the ~128 MB isolate limit and OOM. Photos are
// embedded in order until this budget is reached; the rest are omitted (logged)
// so the export always completes. 32 MiB keeps the ~2x peak (~64 MiB + overhead)
// well under the limit.
export const APPENDIX_PHOTO_TOTAL_BYTE_BUDGET = 32 * 1024 * 1024;

const ROLE_TITLE: Record<'field_observer' | 'pcr_reviewer', string> = {
    field_observer: 'Field Observer',
    pcr_reviewer: 'PCR Reviewer',
};

/** Mirror of cmd-consumer.ts's backoff curve — capped exponential. */
function backoffSeconds(attempts: number): number {
    return Math.min(30 * 2 ** attempts, 3600);
}

/**
 * Fetch one appendix photo's bytes from R2 and (when `images` is bound)
 * downscale it. Returns `null` when the object is missing in R2 — the caller
 * skips that photo rather than failing the whole export. `originalBytes` is
 * loop-local in the caller and goes out of scope once this resolves, so peak
 * memory across the appendix loop stays O(one original + N downscaled), not
 * O(N originals).
 */
async function loadAppendixPhotoBytes(
    photos: R2Bucket,
    images: ImagesBinding | undefined,
    key: string,
): Promise<{ bytes: Uint8Array; widthPx: number; heightPx: number; type: 'jpg' | 'png' } | null> {
    const obj = await photos.get(key);
    if (!obj) return null;
    const originalBytes = new Uint8Array(await obj.arrayBuffer());
    const sniffed = sniffImageDimensions(originalBytes);
    // Fallback dims when the header sniff fails (unrecognized format) — a 4:3
    // guess is close enough that a mis-sized embed never blocks the export.
    const origWidth = sniffed?.width ?? APPENDIX_PHOTO_DOWNSCALE_WIDTH_PX;
    const origHeight = sniffed?.height ?? Math.round(APPENDIX_PHOTO_DOWNSCALE_WIDTH_PX * 0.75);
    const type = sniffed?.type ?? 'jpg';

    if (!images) {
        return { bytes: originalBytes, widthPx: origWidth, heightPx: origHeight, type };
    }
    try {
        const out = await images.input(originalBytes)
            .transform({ width: APPENDIX_PHOTO_DOWNSCALE_WIDTH_PX })
            .output({ format: 'image/jpeg' });
        const downscaled = new Uint8Array(await out.response().arrayBuffer());
        // CF Images 'scale-down' fit never upscales — the true output width is
        // min(original, target); height follows the ORIGINAL aspect ratio.
        const embedWidth = Math.min(origWidth, APPENDIX_PHOTO_DOWNSCALE_WIDTH_PX);
        const embedHeight = origWidth > 0 ? Math.round(origHeight * (embedWidth / origWidth)) : origHeight;
        return { bytes: downscaled, widthPx: embedWidth, heightPx: embedHeight, type: 'jpg' };
    } catch (err) {
        logger.warn('[word-export] photo downscale failed — embedding original', { key, error: String(err) });
        return { bytes: originalBytes, widthPx: origWidth, heightPx: origHeight, type };
    }
}

/** Minimal shape of one `photoAppendix` entry (server/lib/report-photos.ts AppendixPhoto). */
interface AppendixPhotoRef { photoNo: number; key: string; caption: string | null }

/** Sequentially fetch + downscale every appendix photo. Never parallelizes
 *  the fetch loop — see the module doc comment. Embeds photos in order until
 *  APPENDIX_PHOTO_TOTAL_BYTE_BUDGET is reached, then omits the rest (logged) so
 *  a large report can never OOM the isolate — critical when env.IMAGES is unset
 *  and photos embed at full resolution. Exported for the memory-budget unit test. */
export async function buildAppendixPhotoInputs(
    photos: R2Bucket,
    images: ImagesBinding | undefined,
    appendix: AppendixPhotoRef[],
): Promise<DocxAppendixPhoto[]> {
    const out: DocxAppendixPhoto[] = [];
    let embeddedBytes = 0;
    let skipped = 0;
    for (const p of appendix) {
        const loaded = await loadAppendixPhotoBytes(photos, images, p.key);
        if (!loaded) {
            logger.warn('[word-export] appendix photo missing in R2 — skipped', { key: p.key, photoNo: p.photoNo });
            continue;
        }
        // Always keep at least one photo (out.length === 0) so a single oversized
        // original never yields an empty appendix; after that, stop once the
        // running total would exceed the embed budget.
        if (out.length > 0 && embeddedBytes + loaded.bytes.byteLength > APPENDIX_PHOTO_TOTAL_BYTE_BUDGET) {
            skipped++;
            continue;
        }
        embeddedBytes += loaded.bytes.byteLength;
        out.push({
            photoNo: String(p.photoNo),
            ...(p.caption ? { caption: p.caption } : {}),
            bytes: loaded.bytes,
            widthPx: loaded.widthPx,
            heightPx: loaded.heightPx,
            type: loaded.type,
        });
    }
    if (skipped > 0) {
        logger.warn('[word-export] appendix photo byte budget reached — remaining photos omitted from .docx', {
            embeddedCount: out.length,
            skippedCount: skipped,
            embeddedBytes,
            budgetBytes: APPENDIX_PHOTO_TOTAL_BYTE_BUDGET,
        });
    }
    return out;
}

/** Cost-item description column: component, plus location/remedy when present. */
function costLineDescription(item: { component: string; location: string; suggestedRemedy: string }): string {
    return [item.component, item.location, item.suggestedRemedy].filter((s) => s && s.length > 0).join(' — ');
}

/**
 * Commercial PCA Phase C real shape -> the builder's `DocxCostTables`. TABLE 1
 * is a genuine pivot: the real `Table1` is `{ immediate: Table1Row[], shortTerm:
 * Table1Row[] }` (each `Table1Row` = `{ item: CostItem, total }`), not a flat
 * `CostLine[]` with a `description` field — `CostItem` splits that across
 * `component`/`location`/`suggestedRemedy`.
 *
 * TABLE 2 (Reserve Schedule) maps the real `ReserveSchedule` — ONE shared year
 * grid (`years: number[]`) with a FLAT `rows: ReserveRow[]` (each a single item
 * placed in ONE `placementYear`) plus the per-year uninflated/cumulative-
 * inflated arrays, grand totals, and Per-SF metrics — straight onto the
 * builder's `DocxReserveSchedule`, which carries the same shared grid + summary
 * rows. Each `ReserveRow` becomes a `DocxReserveScheduleRow` (system +
 * flattened description + placement year + replacement cents); the summary
 * arrays and Per-SF values pass through unchanged so `buildTable2` can render
 * the "Total Uninflated" / "Cumulative Inflated" / Per-SF footer rows exactly
 * like the HTML report.
 */
function adaptCostTables(costTables: {
    table1: {
        immediate: Array<{ item: { system: string; component: string; location: string; suggestedRemedy: string; quantity: number | null; unitCostCents: number | null }; total: number }>;
        shortTerm: Array<{ item: { system: string; component: string; location: string; suggestedRemedy: string; quantity: number | null; unitCostCents: number | null }; total: number }>;
    };
    reserveSchedule: {
        years: number[];
        rows: Array<{ item: { system: string; component: string; location: string; suggestedRemedy: string }; placementYear: number; replacementCents: number }>;
        uninflatedByYear: number[];
        cumulativeInflatedByYear: number[];
        totalUninflatedCents: number;
        totalInflatedCents: number;
        perSfUninflatedAllYears: number | null;
        perSfInflatedAllYears: number | null;
        perSfInflatedPerYear: number | null;
    } | null;
} | null): ReportDocxInput['costTables'] {
    if (!costTables) return null;
    const toLine = (bucket: DocxCostLine['bucket']) =>
        (row: { item: { system: string; component: string; location: string; suggestedRemedy: string; quantity: number | null; unitCostCents: number | null }; total: number }): DocxCostLine => ({
            system: row.item.system,
            description: costLineDescription(row.item),
            bucket,
            quantity: row.item.quantity,
            unitCostCents: row.item.unitCostCents,
            totalCents: row.total,
        });
    const table1: DocxCostLine[] = [
        ...costTables.table1.immediate.map(toLine('immediate')),
        ...costTables.table1.shortTerm.map(toLine('short_term')),
    ];
    const rs = costTables.reserveSchedule;
    const reserveSchedule: DocxReserveSchedule | null = rs
        ? {
            years: rs.years,
            rows: rs.rows.map((row) => ({
                system: row.item.system,
                description: costLineDescription(row.item),
                placementYear: row.placementYear,
                replacementCents: row.replacementCents,
            })),
            uninflatedByYear: rs.uninflatedByYear,
            cumulativeInflatedByYear: rs.cumulativeInflatedByYear,
            totalUninflatedCents: rs.totalUninflatedCents,
            totalInflatedCents: rs.totalInflatedCents,
            perSfUninflatedAllYears: rs.perSfUninflatedAllYears,
            perSfInflatedAllYears: rs.perSfInflatedAllYears,
            perSfInflatedPerYear: rs.perSfInflatedPerYear,
        }
        : null;
    return { table1, reserveSchedule };
}

/**
 * PCA registry narrative body/items for one `outline` id. Mirrors
 * app/components/portal/sections/report/PcaSkeleton.tsx's rendering
 * (the ground truth for §1-§2 + chapter-divider order) field-for-field.
 * `null` heading-only ids (chapter dividers, §1.3 Opinion of Cost, §1.4
 * Deviations, §3 Property Description) render as a bare heading — Opinion
 * of Cost is filled by the separately-emitted TABLE 1/2, Deviations by the
 * `deviations` sub-table attached at the call site, Property Description by
 * the Building Profile table emitted earlier in `buildReportDocx`, and the
 * §5-§10 system chapter dividers (site/structural-envelope/mep/interior/
 * life-safety) by the actual inspection findings sections appended after
 * this narrative block — PcaSkeleton documents that these ids carry no
 * narrative of their own; the per-item findings render separately, keyed by
 * the inspection template's own section ids, which do not line up with the
 * ASTM registry ids 1:1.
 */
function narrativeBodyForId(
    id: string,
    narrative: { summaryGeneralDescription: string; summaryPhysicalCondition: string; summaryRecommendations: string; purpose: string; scopeOfWork: string; limitationsExceptions: string; reconnaissance: string; additionalConsiderations: string },
    relianceText: { userReliance: string; pointInTime: string; siteSpecific: string },
): string | null {
    switch (id) {
        case 'summary.general-description': return narrative.summaryGeneralDescription;
        case 'summary.physical-condition': return narrative.summaryPhysicalCondition;
        case 'summary.recommendations': return narrative.summaryRecommendations;
        case 'introduction.purpose': return narrative.purpose;
        case 'introduction.scope-of-work': return narrative.scopeOfWork;
        case 'introduction.limitations-exceptions': return narrative.limitationsExceptions;
        case 'introduction.reconnaissance': return narrative.reconnaissance;
        case 'introduction.user-reliance':
            return [relianceText.userReliance, relianceText.pointInTime, relianceText.siteSpecific]
                .filter((s) => s && s.length > 0).join('\n\n');
        default: return null;
    }
}

/** §4 Document Review & Interviews narrative items — checklist rows + PSQ status. */
function documentReviewItems(
    documentReview: Array<{ label: string; requested: boolean; received: boolean; reviewed: boolean; na: boolean; notes: string | null }>,
    psq: { status: string } | null,
): Array<{ label: string; narrative: string }> {
    const items = documentReview.map((d) => {
        const flags = [
            d.na ? 'N/A' : null,
            d.requested ? 'Requested' : null,
            d.received ? 'Received' : null,
            d.reviewed ? 'Reviewed' : null,
        ].filter((s): s is string => s !== null).join(', ') || 'Not requested';
        return { label: d.label, narrative: d.notes ? `${flags} — ${d.notes}` : flags };
    });
    if (psq) items.push({ label: 'Pre-Survey Questionnaire (PSQ)', narrative: `Status: ${psq.status}` });
    return items;
}

/** One narrative-only DocxSection whose body/items resolve to nothing renders
 *  as no section at all (buildSections's empty-section guard) — so ids with
 *  no content here are safe to emit unconditionally. */
function buildNarrativeSections(
    outline: Array<{ id: string; level: number; title: string }>,
    pcaReport: {
        narrative: { summaryGeneralDescription: string; summaryPhysicalCondition: string; summaryRecommendations: string; purpose: string; scopeOfWork: string; limitationsExceptions: string; reconnaissance: string; additionalConsiderations: string };
        deviations: Array<{ area: string; deviation: string; baselineRequirement: string; reason: string }>;
    },
    relianceText: { userReliance: string; pointInTime: string; siteSpecific: string },
    documentReview: Array<{ label: string; requested: boolean; received: boolean; reviewed: boolean; na: boolean; notes: string | null }>,
    psq: { status: string } | null,
): DocxSection[] {
    // Front-matter registry entries (level 0: transmittal-letter, systems-summary,
    // pca-summary) are rendered by their own dedicated builder slots, not here.
    const chapterIds = outline.filter((e) => e.level >= 1);
    return chapterIds.map((entry): DocxSection => {
        if (entry.id === 'summary.deviations') {
            return {
                id: entry.id,
                level: entry.level,
                title: entry.title,
                deviations: pcaReport.deviations.map((d) => ({
                    area: d.area,
                    description: `${d.deviation} — Baseline: ${d.baselineRequirement} — Reason: ${d.reason}`,
                })),
            };
        }
        if (entry.id === 'document-review') {
            return { id: entry.id, level: entry.level, title: entry.title, items: documentReviewItems(documentReview, psq) };
        }
        const body = narrativeBodyForId(entry.id, pcaReport.narrative, relianceText);
        return { id: entry.id, level: entry.level, title: entry.title, ...(body ? { body } : {}) };
    });
}

/**
 * The actual inspection findings — payload `sections` (template-schema
 * sections/items, e.g. "Roofing" / "Roof covering"), rendered AFTER the PCA
 * narrative block (mirrors ReportView.tsx: `<PcaSkeleton>` then
 * `filteredSections`). One DocxSection per template section; each item's
 * narrative joins its notes + included information/defect comments.
 */
function buildFindingsSections(sections: Array<{
    id: string;
    title: string;
    items: Array<{
        label: string;
        ratingLabel: string | null;
        notes: string | null;
        resolvedTabs: {
            information: Array<{ included: boolean; effectiveComment: string }>;
            defects: Array<{ included: boolean; effectiveComment: string }>;
        };
    }>;
}>): DocxSection[] {
    return sections.map((sec): DocxSection => ({
        id: sec.id,
        level: 1,
        title: sec.title,
        items: sec.items.map((item) => {
            const parts = [
                item.notes,
                ...item.resolvedTabs.information.filter((c) => c.included).map((c) => c.effectiveComment),
                ...item.resolvedTabs.defects.filter((d) => d.included).map((d) => d.effectiveComment),
            ].filter((s): s is string => Boolean(s && s.length > 0));
            return {
                label: item.label,
                ...(item.ratingLabel ? { ratingLabel: item.ratingLabel } : {}),
                ...(parts.length > 0 ? { narrative: parts.join(' ') } : {}),
            };
        }),
    }));
}

/**
 * PIVOT the real `getReportData` payload into the `report-docx.ts` builder's
 * `ReportDocxInput`. See the module doc comment + `adaptCostTables` for the
 * two hardest mismatches (cost tables). `reportData` is intentionally typed
 * structurally (the exact subset this adapter reads) rather than importing
 * `InspectionService`'s inferred return type, so this module stays decoupled
 * from the service's internal shape beyond the fields it actually consumes.
 */
export function adaptReportDocxInput(
    reportData: {
        inspection: { propertyAddress: string | null };
        reportTier: 'light_commercial' | 'full_pca';
        outline: Array<{ id: string; level: number; title: string }>;
        pcaReport: {
            narrative: { transmittalLetter: string; summaryGeneralDescription: string; summaryPhysicalCondition: string; summaryRecommendations: string; purpose: string; scopeOfWork: string; limitationsExceptions: string; reconnaissance: string; additionalConsiderations: string };
            systemsSummary: Array<{ systemId: string; systemTitle: string; worstSeverity: string; counts: { safety: number; recommendation: number; maintenance: number } }>;
            deviations: Array<{ area: string; deviation: string; baselineRequirement: string; reason: string }>;
        };
        reportSignoffs: Array<{ role: 'field_observer' | 'pcr_reviewer'; name: string }>;
        buildingProfile: DocxProfileRow[];
        sections: Parameters<typeof buildFindingsSections>[0];
        costTables: Parameters<typeof adaptCostTables>[0];
        relianceText: { userReliance: string; pointInTime: string; siteSpecific: string };
        documentReview: Parameters<typeof documentReviewItems>[0];
        psq: { status: string } | null;
    },
    companyName: string | null,
    appendixPhotos: DocxAppendixPhoto[],
): ReportDocxInput {
    const fieldObserver = reportData.reportSignoffs.find((s) => s.role === 'field_observer');
    const reviewer = reportData.reportSignoffs.find((s) => s.role === 'pcr_reviewer');
    return {
        inspection: { propertyAddress: reportData.inspection.propertyAddress, companyName },
        tier: reportData.reportTier,
        outline: reportData.outline,
        transmittal: { body: reportData.pcaReport.narrative.transmittalLetter },
        signatures: {
            ...(fieldObserver ? { fieldObserver: { name: fieldObserver.name, title: ROLE_TITLE.field_observer } } : {}),
            ...(reviewer ? { reviewer: { name: reviewer.name, title: ROLE_TITLE.pcr_reviewer } } : {}),
        },
        // The real row is System/WorstSeverity/per-category counts, not a
        // single Priority column — condition capitalizes the worst severity;
        // priority joins whichever categories are non-zero (a best-effort
        // collapse of the 3-count breakdown into the builder's one column).
        systemsSummary: reportData.pcaReport.systemsSummary.map((row) => ({
            system: row.systemTitle,
            condition: row.worstSeverity.charAt(0).toUpperCase() + row.worstSeverity.slice(1),
            priority: [
                row.counts.safety > 0 ? `Safety: ${row.counts.safety}` : null,
                row.counts.recommendation > 0 ? `Recommendation: ${row.counts.recommendation}` : null,
                row.counts.maintenance > 0 ? `Maintenance: ${row.counts.maintenance}` : null,
            ].filter((s): s is string => s !== null).join(', ') || 'None',
        })),
        buildingProfile: reportData.buildingProfile,
        sections: [
            ...buildNarrativeSections(
                reportData.outline, reportData.pcaReport, reportData.relianceText,
                reportData.documentReview, reportData.psq,
            ),
            ...buildFindingsSections(reportData.sections),
        ],
        costTables: adaptCostTables(reportData.costTables),
        appendixPhotos,
    };
}

/**
 * Batch handler for the `openinspection-word-export` queue. Never throws —
 * every failure path is caught per-message so one bad job cannot wedge the
 * batch (mirrors `handleCmdBatch`'s strictly-per-message ack/retry).
 */
export async function handleWordExportBatch(env: WordExportConsumerEnv, batch: MessageBatch<unknown>): Promise<void> {
    const exportService = new ReportExportService(env.DB, env.PHOTOS);
    for (const msg of batch.messages) {
        const job = parseWordExportJob(msg.body);
        if (!job) {
            // A malformed envelope can never succeed on retry — ack (drop) and
            // log loudly rather than retrying forever.
            logger.error('[word-export] malformed job envelope — dropping', { id: msg.id });
            msg.ack();
            continue;
        }
        try {
            await exportService.markBuilding(job.exportId, job.tenantId);

            const inspectionService = new InspectionService(
                env.DB, env.PHOTOS, undefined, env.TENANT_CACHE, env.IMAGES, undefined,
                env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET,
            );
            // Identity makePhotoUrl — photoAppendix entries carry the raw R2
            // key (not a token-scoped URL) so this consumer can PHOTOS.get it.
            const reportData = await inspectionService.getReportData(job.inspectionId, job.tenantId, (key) => key);

            if (!reportData.reportTier || !reportData.pcaReport) {
                throw new Error(`Word export is commercial-only — inspection ${job.inspectionId} has no report tier`);
            }
            // Bind narrowed locals immediately — property-access narrowing on
            // `reportData.reportTier`/`.pcaReport` is not guaranteed to survive
            // the `await`s below, but a fresh `const` binding's type is fixed at
            // assignment.
            const reportTier = reportData.reportTier;
            const pcaReport = reportData.pcaReport;

            const brand = await new BrandingService(env.DB).getBrand(job.tenantId);
            const appendixPhotos = reportTier === 'light_commercial'
                ? []
                : await buildAppendixPhotoInputs(env.PHOTOS, env.IMAGES, reportData.photoAppendix);

            const input = adaptReportDocxInput(
                { ...reportData, reportTier, pcaReport },
                brand.companyName,
                appendixPhotos,
            );
            const bytes = await buildReportDocx(input);

            const key = r2Keys.reportWordExport(job.tenantId, job.inspectionId, job.exportId);
            await env.PHOTOS.put(key, bytes, {
                httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            });
            await exportService.markReady(job.exportId, job.tenantId, key, bytes.byteLength);
            logger.info('[word-export] build complete', { exportId: job.exportId, inspectionId: job.inspectionId, sizeBytes: bytes.byteLength });
            msg.ack();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('[word-export] build failed — retrying', { exportId: job.exportId, inspectionId: job.inspectionId, attempts: msg.attempts },
                err instanceof Error ? err : undefined);
            await exportService.markFailed(job.exportId, job.tenantId, message).catch(() => {});
            msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
        }
    }
}
