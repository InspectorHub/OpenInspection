import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, asc } from 'drizzle-orm';
import { inspections, inspectionResults, templates, users, tenantConfigs, reportVersions, inspectionUnits, inspectorCredentials } from '../../lib/db/schema';
import { buildUnitConditionMatrix, defectCountsByUnit } from '../../lib/unit-scope';
import { Errors } from '../../lib/errors';
import { resolveTenantTimeZone } from '../../lib/tz';
import { parseReinspectionStatuses } from '../../lib/reinspection-status';
import { computeReportStats, getRatingColor, getRatingBucket, getNaKind, mapCustomDefectsForReport, type RatingLevel } from '../../lib/report-utils';
import { mapRatingSystemLevels } from '../../lib/map-rating-levels';
import { renderTemplate } from '../../lib/mustache';
import { mapRepairItems } from '../../lib/report-repair-items';
import { selectReportMedia, type ReportMediaContext } from '../../lib/report-video';
import { findingKey, DEFAULT_UNIT } from '../../lib/finding-key';
import { sha256Hex } from '../signing-key.service';
import { RENDER_VERSION } from '../../lib/pdf';
import { resolvePdfSettings, type PdfSettings } from '../../lib/pdf-settings';
import { isReportPublished } from '../../lib/status/report-status';
import { resolveBuildingProfile } from '../../lib/building-profile';
import { buildSystemsSummary } from '../../lib/pca-systems-summary';
import { buildPcaReportBlock } from '../../lib/pca-report-block';
import { gatedSectionRegistry } from '../../lib/pca-section-registry';
import { buildReportOutline } from '../../lib/report-outline';
import { resolveProfile } from '../../lib/report-style/resolve';
import type { Deviation } from '../../lib/pca-deviations';
import type { DefectCommentState } from '../../types/inspection-item-state';
import { resolveCoverUrl, resolveDefectMustacheVars, RECOMMENDATION_CATEGORY_LABELS } from './shared';
import { InspectionSubService } from './base';
import { DefectCategoryService } from './defect-category.service';
import { buildCostTables } from '../../lib/pca-costs';
import { CostItemService } from '../cost-item.service';
import { resolveReportTier } from '../../lib/report-tier';
import { assignPhotoNumbers, derivePhotoMode, buildPhotoRefIndex, resolvePhotoRef, type AppendixPhoto, type PhotoMode } from '../../lib/report-photos';
import { computeConformance, deriveConformanceInput, type AstmConformance } from '../../lib/pca-conformance';
import { RELIANCE_TEMPLATES } from '../../lib/pca-reliance-text';
import { ComplianceService } from '../compliance/pca-compliance.service';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';
import type {
    PhotoEntry,
    CannedState,
    DefectState,
    ResultsProjection,
} from '../../lib/collab/results-doc.types';

/**
 * Authoring unification Plan-4 module K — pure decision of whether a defect's
 * category counts toward the report Summary rollup. Resolves `category`
 * (a `defect_categories.id` OR a legacy seed name, e.g. seed template JSON
 * still stores `"safety"`) against the tenant's rows by id-or-name, matching
 * how `categoryColor` is resolved in `getReportData`. An unresolved/absent
 * category defaults to `true` — a defect must never be silently dropped from
 * the Summary just because its category can't be matched.
 */
export function defectDrivesSummary(
    category: string | null | undefined,
    cats: Array<{ id: string; name: string; drivesSummary: boolean }>,
): boolean {
    if (!category) return true;
    const row = cats.find((c) => c.id === category || c.name === category);
    return row ? row.drivesSummary : true;
}

/**
 * Report data aggregation: getReportData (the resolved, render-ready report
 * shape), its stable content hash, and the PDF footer context. Extracted
 * verbatim from InspectionService. getReportContentHash calls getReportData
 * internally (same service).
 */
export class InspectionReportService extends InspectionSubService {
    /**
     * `encryptionSecret` is only consumed to construct a scoped
     * `ComplianceService` (Phase M) for full_pca reports — every other method
     * on this service is unaffected. Optional so existing positional
     * construction call sites (and unit tests that build this service
     * directly) keep working unchanged; full_pca reports built without a
     * secret still resolve sign-off/PSQ/doc-review reads (which don't touch
     * crypto), just with an empty key material fallback.
     */
    constructor(
        db: D1Database,
        r2?: R2Bucket,
        sdb?: ScopedDB,
        kv?: KVNamespace,
        images?: ImagesBinding,
        private readonly encryptionSecret?: string,
    ) {
        super(db, r2, sdb, kv, images);
    }

    /**
     * Builds structured report data for a given inspection.
     *
     * `makePhotoUrl` lets the caller control how each photo key is turned into
     * a fetchable URL. The default points at the authenticated editor serve
     * route; the public report endpoint passes a token-scoped public URL so the
     * no-login report viewer can load images (A-9).
     */
    async getReportData(
        inspectionId: string,
        tenantId: string,
        makePhotoUrl: (key: string) => string =
            (key) => `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}`,
        // Plan 7 — video walk-through. When present, each media entry is enriched
        // with its resolved kind (image / video-player / video-poster) so the web
        // report + PDF render chain can branch. Absent (legacy callers) ⇒ photos
        // resolve exactly as before (image only).
        videoCtx?: ReportMediaContext,
    ) {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const template = inspection.templateId
            ? await db.select().from(templates).where(and(eq(templates.id, inspection.templateId), eq(templates.tenantId, tenantId))).get()
            : null;
        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        // Spec 5B — v2 schema is the authoritative shape. Items are 'rich'
        // (rating + 3 tabs of canned comments) or 'text' (free-text notes).
        interface CannedInfoComment { id: string; title: string; comment: string; default: boolean }
        interface CannedDefect      { id: string; title: string; category: string; location: string; comment: string; photos: string[]; default: boolean }
        interface ItemTabs          { information: CannedInfoComment[]; limitations: CannedInfoComment[]; defects: CannedDefect[] }
        interface SchemaItem        { id: string; label: string; icon?: string; type?: string; ratingOptions?: string[]; tabs?: ItemTabs; number?: string }
        // Track E2 (Spectora App.A) — per-section disclaimer + force-page-break
        // are stored on the schema's section node so the editor can author
        // them and the published report can honor them. Both are optional —
        // legacy templates without these fields render unchanged.
        interface SchemaSection     { id: string; title: string; icon?: string; items: SchemaItem[]; disclaimerText?: string | null; alwaysPageBreak?: boolean }
        interface SchemaData        { schemaVersion?: number; sections: SchemaSection[]; ratingSystem?: { levels: RatingLevel[] } }
        // PhotoEntry, CannedState, DefectState, and ResultsProjection (ItemEntry)
        // are imported from '../../lib/collab/results-doc.types' — single
        // source of truth for the inspection_results.data projection shape.

        // Feature #20 — prefer the per-inspection templateSnapshot over the
        // source template.schema. The snapshot is the authoritative shape
        // for the inspection once it's been created: rating-system swaps,
        // inline added/removed sections + items, and per-job tweaks all
        // land there. Falling back to template.schema preserves behavior
        // for legacy inspections that pre-date the snapshot column.
        const inspectionSnapshotRaw = (inspection as unknown as { templateSnapshot?: unknown }).templateSnapshot;
        const inspectionSnapshot = inspectionSnapshotRaw
            ? (typeof inspectionSnapshotRaw === 'string' ? JSON.parse(inspectionSnapshotRaw as string) : inspectionSnapshotRaw)
            : null;
        const hasInspectionSnapshot = inspectionSnapshot
            && typeof inspectionSnapshot === 'object'
            && Array.isArray((inspectionSnapshot as { sections?: unknown }).sections)
            && (inspectionSnapshot as { sections: unknown[] }).sections.length > 0;
        const rawSchema = hasInspectionSnapshot
            ? inspectionSnapshot
            : template?.schema
                ? (typeof template.schema === 'string' ? JSON.parse(template.schema) : template.schema)
                : { sections: [] };
        // Support both formats: { sections: [...] } and flat array of items
        const schemaData: SchemaData = Array.isArray(rawSchema)
            ? { sections: [{ id: 'general', title: 'General', items: rawSchema }] }
            : (rawSchema as SchemaData).sections ? rawSchema as SchemaData : { sections: [] };

        // Sprint 2 S2-1 + Feature #20 — multi-rating system resolution.
        // Order of precedence:
        //   1. inspection_results.rating_system_snapshot (frozen at creation;
        //      cleared when the inspector switches systems mid-inspection)
        //   2. inspection.templateSnapshot.ratingSystem  ← phase 2 swap target
        //   3. template.rating_system_id → live rating_systems row
        //   4. legacy template.schema.ratingSystem.levels
        let levels: RatingLevel[] = [];
        const snapshotRaw = (resultsRow as unknown as { ratingSystemSnapshot?: unknown })?.ratingSystemSnapshot;
        if (snapshotRaw) {
            const snap = typeof snapshotRaw === 'string' ? JSON.parse(snapshotRaw) : snapshotRaw;
            if (snap && Array.isArray((snap as { levels?: unknown }).levels)) {
                levels = mapRatingSystemLevels((snap as { levels: Array<Record<string, unknown>> }).levels);
            }
        }
        if (levels.length === 0 && hasInspectionSnapshot) {
            const snapLevels = (inspectionSnapshot as { ratingSystem?: { levels?: unknown[] } }).ratingSystem?.levels;
            if (Array.isArray(snapLevels)) {
                levels = mapRatingSystemLevels(snapLevels as Array<Record<string, unknown>>);
            }
        }
        if (levels.length === 0 && template && (template as unknown as { ratingSystemId?: string | null }).ratingSystemId) {
            const ratingSystemId = (template as unknown as { ratingSystemId: string | null }).ratingSystemId as string | null;
            if (ratingSystemId) {
                const { ratingSystems } = await import('../../lib/db/schema');
                const sysRow = await db.select().from(ratingSystems)
                    .where(and(eq(ratingSystems.id, ratingSystemId), eq(ratingSystems.tenantId, tenantId)))
                    .get();
                if (sysRow) {
                    const rawLevels = sysRow.levels as unknown;
                    const lvlArr = typeof rawLevels === 'string' ? JSON.parse(rawLevels) : rawLevels;
                    if (Array.isArray(lvlArr)) levels = mapRatingSystemLevels(lvlArr);
                }
            }
        }
        if (levels.length === 0) {
            levels = schemaData.ratingSystem?.levels ?? [];
        }
        const resultData: ResultsProjection = resultsRow?.data
            ? (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as ResultsProjection
            : {};

        const stats = computeReportStats(schemaData.sections, resultData, levels);

        // Plan 7 — map a stored media entry → its report photo object. Photos keep
        // the existing { key: displayKey, originalKey, url } shape; videos additionally
        // carry the resolved media kind (player vs poster) when `videoCtx` is present.
        // Without `videoCtx` (legacy callers) it degrades to the photo-only shape.
        const mapReportPhoto = (p: PhotoEntry) => {
            const isVideo = p.mediaType === 'video';
            const displayKey = p.annotatedKey || p.croppedKey || p.key;
            const url = isVideo ? '' : makePhotoUrl(displayKey);
            const base = { key: displayKey, originalKey: p.key, url };
            if (!videoCtx) return base;
            const media = selectReportMedia(
                { key: displayKey, url, mediaType: p.mediaType, provider: p.provider, streamUid: p.streamUid, mediaId: p.mediaId, posterKey: p.posterKey, posterPct: p.posterPct, durationSec: p.durationSec },
                videoCtx,
            );
            return { ...base, media };
        };

        // Spec 5B helper — for a given item, resolve the effective set of
        // included comments per tab. Honors per-inspection toggles + text
        // overrides, falling back to the template's `default: true` flag.
        function resolveTab<T extends CannedInfoComment | CannedDefect>(
            templateEntries: T[] | undefined,
            states: CannedState[] | DefectState[] | undefined,
        ): Array<T & { included: boolean; effectiveComment: string }> {
            if (!templateEntries) return [];
            const stateMap = new Map<string, CannedState | DefectState>();
            for (const s of states ?? []) stateMap.set(s.cannedId, s);
            return templateEntries.map(e => {
                const st = stateMap.get(e.id);
                const included = st ? !!st.included : !!e.default;
                const override = st && typeof st.comment === 'string' && st.comment.length > 0 ? st.comment : null;
                return {
                    ...e,
                    included,
                    effectiveComment: override ?? e.comment,
                };
            });
        }

        // Authoring unification Plan-4 module K — resolve the tenant's defect
        // categories ONCE (seeding the 3 canonical rows on first use), so the
        // per-defect Summary gate (defectDrivesSummary) and chip color can be
        // looked up per-defect below with no N+1 query. Keyed by BOTH name
        // and id: seed template JSON stores category NAMES ("safety"), while
        // a template authored after Plan-4 may store a defect_categories.id.
        const defectCategories = await new DefectCategoryService(this.db).ensureSeed(tenantId);
        const categoryColorByKey = new Map<string, string>();
        for (const cat of defectCategories) {
            categoryColorByKey.set(cat.name, cat.color);
            categoryColorByKey.set(cat.id, cat.color);
        }

        const sections = schemaData.sections.map((sec: SchemaSection) => ({
            id: sec.id,
            title: sec.title || (sec as unknown as Record<string, string>).name || 'Untitled',
            icon: sec.icon ?? null,
            defectCount: stats.sectionDefects[sec.id] ?? 0,
            // Track E2 — surface per-section flags so the report viewer can
            // render the disclaimer + apply the page-break attribute. Null
            // when unset so the renderer can short-circuit cleanly.
            disclaimerText:  (typeof sec.disclaimerText === 'string' && sec.disclaimerText.trim().length > 0)
                ? sec.disclaimerText.trim()
                : null,
            alwaysPageBreak: sec.alwaysPageBreak === true,
            items: sec.items.map((item: SchemaItem) => {
                const res = resultData[findingKey(DEFAULT_UNIT, sec.id, item.id)] || resultData[item.id] || {};
                const ratingId = res.rating ?? null;
                const bucket = getRatingBucket(ratingId, levels);
                const level = levels.find((l: RatingLevel) => l.id === ratingId);

                // Phase T (T16): prefer annotated composite when present; expose original via originalKey.
                // Plan 7: mapReportPhoto enriches video entries with their media kind.
                // #181 PR-G: skip pending uploads — they have no R2 object yet (would 404 a render).
                const photos = (res.photos || []).filter(p => !p.pendingUpload).map(mapReportPhoto);

                // Spec 5B — resolve the three canned-comment tabs.
                const information = resolveTab(item.tabs?.information, res.tabs?.information);
                const limitations = resolveTab(item.tabs?.limitations, res.tabs?.limitations);
                // For defects, also let inspector override category, location, and attach photos.
                const defectStates = res.tabs?.defects ?? [];
                const defectStateMap = new Map<string, DefectState>();
                for (const s of defectStates) defectStateMap.set(s.cannedId, s);
                const defects = (item.tabs?.defects ?? []).map(d => {
                    const st = defectStateMap.get(d.id);
                    const included = st ? !!st.included : !!d.default;
                    const override = st && typeof st.comment === 'string' && st.comment.length > 0 ? st.comment : null;
                    const effectiveCategory = st?.category ?? d.category;
                    return {
                        ...d,
                        included,
                        effectiveComment: renderTemplate(override ?? d.comment, resolveDefectMustacheVars(st as DefectCommentState | undefined, d as CannedDefect, res.attributes)),
                        effectiveCategory,
                        // Authoring unification Plan-4 module K — the tenant's
                        // configured category color; undefined (no color) falls
                        // back to DefectCategoryChip's own tokened/muted styling.
                        categoryColor: categoryColorByKey.get(effectiveCategory),
                        // Category-axis Summary-inclusion signal
                        // (defect_categories.drivesSummary), resolved data-driven
                        // rather than by a hard-coded category name. Exposed on the
                        // report data model as the foundation for a category-based
                        // "Summary" view; orthogonal to ReportView's severity-based
                        // Summary filter (spec §9), which no consumer conflates.
                        drivesSummary: defectDrivesSummary(effectiveCategory, defectCategories),
                        effectiveLocation: (typeof st?.location === 'string' && st.location.length > 0) ? st.location : d.location,
                        // #181 PR-G: pending uploads have no R2 object yet — skip them.
                        defectPhotos: (st?.photos ?? []).filter(p => !p.pendingUpload).map(mapReportPhoto),
                        // Sprint 2 S2-3 / S2-4 — per-defect contractor recommendation +
                        // repair estimate range. Null when the inspector left them blank.
                        recommendationId: st?.recommendationId ?? null,
                        estimateLow:      typeof st?.estimateLow  === 'number' ? st.estimateLow  : null,
                        estimateHigh:     typeof st?.estimateHigh === 'number' ? st.estimateHigh : null,
                    };
                });

                // FE-3/B-20 — field-authored custom defects join the resolved
                // list (they previously reached only the repair list + stats;
                // the published report silently dropped them).
                const customDefects = mapCustomDefectsForReport(
                    (res as { customComments?: { defects?: Array<{ id: string }> } }).customComments,
                    makePhotoUrl,
                ).map(cd => ({
                    ...cd,
                    categoryColor: categoryColorByKey.get(cd.effectiveCategory),
                    drivesSummary: defectDrivesSummary(cd.effectiveCategory, defectCategories),
                }));

                // Sprint 2 S2-3 / S2-4 — when the inspector left the legacy
                // top-level recommendation / estimate empty but tagged the
                // included canned defects with per-defect values, surface
                // those at the item level so the report card stack can
                // render the badge without extending its data contract.
                //   - estimateMin = min(defects[].estimateLow)
                //   - estimateMax = max(defects[].estimateHigh)
                //   - recommendation = the most-recent included defect's
                //     human-readable label (joined with " · " when several)
                let itemEstimateMin: number | null = res.estimateMin ?? null;
                let itemEstimateMax: number | null = res.estimateMax ?? null;
                let itemRecommendation: string | null = res.recommendation ?? null;
                const includedDefects = defects.filter(d => d.included);
                if (itemEstimateMin == null) {
                    const lows = includedDefects
                        .map(d => d.estimateLow)
                        .filter((n): n is number => typeof n === 'number');
                    if (lows.length > 0) itemEstimateMin = Math.round(Math.min(...lows) / 100);
                }
                if (itemEstimateMax == null) {
                    const highs = includedDefects
                        .map(d => d.estimateHigh)
                        .filter((n): n is number => typeof n === 'number');
                    if (highs.length > 0) itemEstimateMax = Math.round(Math.max(...highs) / 100);
                }
                if (itemRecommendation == null) {
                    const slugs = Array.from(new Set(
                        includedDefects
                            .map(d => d.recommendationId)
                            .filter((s): s is string => typeof s === 'string' && s.length > 0)
                    ));
                    if (slugs.length > 0) {
                        // Resolve labels from the catalog, joined with bullet.
                        // Lazy require so the import isn't pulled into every
                        // service consumer that doesn't render a report.
                        const cats = (RECOMMENDATION_CATEGORY_LABELS as Map<string, string>);
                        itemRecommendation = slugs
                            .map(s => cats.get(s) ?? s)
                            .join(' · ');
                    }
                }

                return {
                    id: item.id,
                    label: item.label || (item as unknown as Record<string, string>).name || 'Untitled',
                    type:  item.type ?? 'rich',
                    ratingOptions: item.ratingOptions ?? null,
                    // Spec 5B — pass the raw template canned tabs through so
                    // the editor can render checkbox toggles. Per-state
                    // resolution happens client-side; the resolved view is
                    // also exposed under `resolvedTabs` for report renderers.
                    tabs: item.tabs ?? null,
                    rating: ratingId,
                    ratingColor: getRatingColor(ratingId, levels),
                    ratingLabel: level?.label ?? ratingId,
                    severityBucket: bucket,
                    naKind: getNaKind(ratingId, levels),
                    notInspectedReason: (res as { notInspectedReason?: string | null }).notInspectedReason ?? null,
                    notes: res.notes ?? null,
                    photos,
                    recommendation: itemRecommendation,
                    estimateMin: itemEstimateMin,
                    estimateMax: itemEstimateMax,
                    repairItems: mapRepairItems(res),
                    // Non-rich item types persist the captured value on
                    // res.value; surface it to the report viewer plus the
                    // unit from item.options so the customer sees "Year
                    // built · 1995 · yr" instead of an empty rating chip.
                    value: (res as { value?: unknown }).value ?? null,
                    unit:  (item as unknown as { options?: { unit?: string } }).options?.unit ?? null,
                    // Spec 5B v2 resolved tab payload — report PDFs render
                    // only entries where `included === true`.
                    resolvedTabs: {
                        information,
                        limitations,
                        // Canned first, then custom — single list for renderers
                        // (custom rows carry isCustom: true).
                        defects: [...defects, ...customDefects],
                    },
                    // #119 — re-inspection passthrough. Null on normal reports;
                    // the report page only consults these when data.reinspection
                    // is set. `original.photos` are resolved to display URLs so
                    // the left column can render the baseline finding grayscale.
                    original: res.original
                        ? {
                            rating: res.original.rating ?? null,
                            notes:  res.original.notes ?? null,
                            // #181 PR-G: pending uploads have no R2 object yet — skip them.
                            photos: (res.original.photos || []).filter(p => !p.pendingUpload).map(mapReportPhoto),
                        }
                        : null,
                    followupStatus: res.followupStatus ?? null,
                    followupNotes:  res.followupNotes ?? null,
                };
            }),
        }));

        // Commercial PCA Phase P — assign continuous, stable photo numbers in
        // render order and collect the centralized photo appendix (Appendix B).
        // photoMode derives from the tier (Phase T) with an optional per-
        // inspection override; computed unconditionally (cheap + deterministic)
        // so the renderer can branch. See server/lib/report-photos.ts.
        const photoMode: PhotoMode = derivePhotoMode({
            reportTier: (inspection as { reportTier?: string | null }).reportTier ?? null,
            override:   (inspection as { reportPhotoMode?: string | null }).reportPhotoMode ?? null,
        });
        const photoNumbering = assignPhotoNumbers(sections as Parameters<typeof assignPhotoNumbers>[0]);
        // assignPhotoNumbers's declared return type is the generic SectionLike[]
        // shape it walks; at runtime each section/item is a shallow copy that
        // keeps every original field (defectCount, rating, ratingColor, ...)
        // plus `photoNo` stamped onto photo/defectPhoto entries. Cast back to
        // the specific literal type of `sections` so downstream consumers of
        // getReportData's inferred return type (report-delivery route,
        // inspection-analytics.service) keep their existing field access.
        const numberedSections = photoNumbering.sections as typeof sections;
        const photoAppendix: AppendixPhoto[] = photoNumbering.appendix;

        let inspectorName: string | null = null;
        let inspectorLicense: string | null = null;
        if (inspection.inspectorId) {
            const inspector = await db.select({ name: users.name, email: users.email, licenseNumber: users.licenseNumber })
                .from(users).where(eq(users.id, inspection.inspectorId)).get();
            inspectorName = inspector?.name || (inspector?.email?.split('@')[0] ?? null);
            inspectorLicense = inspector?.licenseNumber ?? null;
        }

        // Inspector Credentials & Association Badges (Spec B) — the inspector's
        // active credentials, resolved to public asset URLs and snapshotted into
        // the report payload. Empty rows (no image, blank label) are dropped.
        let credentialSnapshot: Array<{ label: string; memberNumber: string | null; imageUrl: string | null }> = [];
        if (inspection.inspectorId) {
            const credRows = await db.select().from(inspectorCredentials)
                .where(and(eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, inspection.inspectorId), eq(inspectorCredentials.active, true)))
                .orderBy(asc(inspectorCredentials.sortOrder), asc(inspectorCredentials.createdAt)).all();
            credentialSnapshot = credRows
                .filter((c) => c.imageR2Key || (c.label ?? '').trim())
                .map((c) => ({ label: c.label, memberNumber: c.memberNumber, imageUrl: c.imageR2Key ? `/api/public/brand-asset?key=${encodeURIComponent(c.imageR2Key)}` : null }));
        }

        // Sprint 2 S2-4 — per-tenant flag controls whether the published
        // report renders "Estimated cost: $X – $Y" badges on defect cards.
        let showEstimates = false;
        // Report Style Presets — tenant's default appearance profile id (resolved below).
        let tenantDefaultProfileId: string | null = null;
        // Per-tenant report-feature flags surfaced to the published report so the
        // client report can render the "View Repair List" and "Build repair request"
        // entries. Read live here (not part of the cached report content).
        let enableRepairList = false;
        let enableCustomerRepairExport = false;
        // Commercial PCA Phase C — tenant-level Reserve Schedule (TABLE 2) opt-in
        // + its assumptions. Read alongside the other tenant report flags.
        let reserveScheduleEnabled = false;
        let reserveTermYears = 12;
        let inflationRateBps: number | null = null;
        // The tenant timezone anchors ALL report times (a report is a shared
        // artifact — never the viewer's browser tz). 'UTC' until resolved.
        let reportTimeZone = 'UTC';
        try {
            const cfg = await db.select({
                showEstimates: tenantConfigs.showEstimates,
                defaultProfileId: tenantConfigs.defaultProfileId,
                enableRepairList: tenantConfigs.enableRepairList,
                enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport,
                reserveScheduleEnabled: tenantConfigs.reserveScheduleEnabled,
                reserveTermYears: tenantConfigs.reserveTermYears,
                inflationRateBps: tenantConfigs.inflationRateBps,
                defaultTimezone: tenantConfigs.defaultTimezone,
            })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
            if (cfg) {
                showEstimates = Boolean(cfg.showEstimates);
                enableRepairList = Boolean(cfg.enableRepairList);
                enableCustomerRepairExport = Boolean(cfg.enableCustomerRepairExport);
                reserveScheduleEnabled = Boolean(cfg.reserveScheduleEnabled);
                reserveTermYears = cfg.reserveTermYears ?? 12;
                inflationRateBps = cfg.inflationRateBps ?? null;
                reportTimeZone = resolveTenantTimeZone(cfg.defaultTimezone);
                tenantDefaultProfileId = cfg.defaultProfileId ?? null;
            }
        } catch {
            // tenant_configs row missing — defaults apply.
        }
        // Report Style Presets (Plan 1a) — three-tier resolution + field-level tweaks.
        const insp = inspection as { profileOverride?: string | null; badgeLayoutOverride?: string | null; reportPhotoColumns?: number | null };
        const styleProfile = resolveProfile(
            { profileOverride: insp.profileOverride ?? null, badgeLayoutOverride: insp.badgeLayoutOverride ?? null, reportPhotoColumns: insp.reportPhotoColumns ?? null },
            template ? { defaultProfileId: (template as { defaultProfileId?: string | null }).defaultProfileId ?? null } : null,
            { defaultProfileId: tenantDefaultProfileId },
        );

        // Round-2 backlog G1 (Spectora §E.2) — Property Facts banner rendered
        // at the top of the published report. Surface the six dedicated
        // columns; the report layer decides whether to render the strip
        // when at least one field is populated.
        const propertyFacts = {
            yearBuilt:      (inspection as { yearBuilt?: number | null }).yearBuilt           ?? null,
            sqft:           (inspection as { sqft?: number | null }).sqft                     ?? null,
            foundationType: (inspection as { foundationType?: string | null }).foundationType ?? null,
            lotSize:        (inspection as { lotSize?: string | null }).lotSize               ?? null,
            bedrooms:       (inspection as { bedrooms?: number | null }).bedrooms             ?? null,
            bathrooms:      (inspection as { bathrooms?: number | null }).bathrooms           ?? null,
        };

        // Commercial PCA Phase T — resolve the report tier from the stored
        // value (defaults commercial -> light_commercial; null on residential).
        // Every later phase (sections/cost/compliance/photos) gates on this.
        const reportTier = resolveReportTier({
            propertyType: (inspection as { propertyType?: string | null }).propertyType ?? null,
            storedTier: (inspection as { reportTier?: 'light_commercial' | 'full_pca' | null }).reportTier ?? null,
        });

        // Commercial PCA Phase C/T — manual cost line items -> two render tables
        // (Opinion of Cost + opt-in Reserve Schedule) + the Phase S ES roll-up.
        // Cost tables are a commercial-PCA construct, gated on report tier: a
        // residential inspection (reportTier null) must NOT surface them — else,
        // e.g., a tenant with reserveScheduleEnabled on would render an empty
        // Reserve Schedule on every residential report. See #234 follow-up.
        const costItemRows = reportTier
            ? await new CostItemService(this.db).listByInspection(inspectionId, tenantId)
            : [];
        const costTables = reportTier
            ? buildCostTables(
                costItemRows,
                { reserveScheduleEnabled, reserveTermYears, inflationRateBps },
                new Date().getFullYear(),
                (inspection as { sqft?: number | null }).sqft ?? null,
            )
            : null;

        // Commercial PCA Phase P/C seam — resolve each reserve row's photo_ref to
        // its assigned appendix photo number for the PHOTO NO. column. Built once
        // here (not threaded into pca-costs.ts, which stays IO/photo-free) now
        // that both the reserve schedule and photoAppendix are available.
        const photoRefIndex = buildPhotoRefIndex(photoAppendix);
        const resolvedCostTables = costTables?.reserveSchedule
            ? {
                ...costTables,
                reserveSchedule: {
                    ...costTables.reserveSchedule,
                    rows: costTables.reserveSchedule.rows.map((row) => ({
                        ...row,
                        photoNo: resolvePhotoRef(photoRefIndex, row.item.photoRef),
                    })),
                },
            }
            : costTables;

        // Commercial PCA Phase F — server-resolved Building Profile rows (presets
        // stay server-only). Renders only when propertyType is set + a field is
        // populated; the report layer decides visibility.
        const buildingProfile = resolveBuildingProfile(
            inspection as Parameters<typeof resolveBuildingProfile>[0],
        );

        // Commercial PCA Phase S — the report skeleton block, GATED to commercial
        // reports so residential home inspections never render the ASTM PCA front
        // matter. buildPcaReportBlock returns null for non-commercial reports; the
        // report layer renders whatever it is handed (null → PcaSkeleton renders
        // nothing), mirroring the Phase F visibility pattern. The registry is the
        // canonical ASTM §11 order (Phase O projects a TOC over it); the cost seam
        // (§1.3 + PCA Summary numbers) is left empty for Phase C.
        const pcaReport = buildPcaReportBlock({
            propertyType: (inspection as { propertyType?: string | null }).propertyType ?? null,
            pcaNarrative: (inspection as { pcaNarrative?: unknown }).pcaNarrative ?? null,
            deviations: (inspection as { deviations?: Deviation[] | null }).deviations ?? null,
            sections: sections as Parameters<typeof buildSystemsSummary>[0],
        });

        // Commercial PCA Phase O — TOC projection over the tier-gated section
        // registry. No reportTier (residential) -> no PCA front matter -> no
        // outline. full_pca gets the full registry (Transmittal Letter +
        // Systems Summary included); light_commercial gets those two dropped
        // by gatedSectionRegistry.
        const outline = reportTier
            ? buildReportOutline(gatedSectionRegistry(reportTier === 'full_pca' ? 'full' : 'light'))
            : [];

        // #120 — amendment trail. Surfaced to the client report page so a
        // re-published report shows "Amended on …" + per-version reasons.
        // Only meaningful when there is more than one published version; live
        // edits do not create versions, so the banner stays hidden until an
        // actual re-publish. Reason reuses report_versions.summary.
        const versionRows = await db.select({
            versionNumber: reportVersions.versionNumber,
            publishedAt:   reportVersions.publishedAt,
            summary:       reportVersions.summary,
            isAmendment:   reportVersions.isAmendment,
        })
            .from(reportVersions)
            .where(and(
                eq(reportVersions.tenantId, tenantId),
                eq(reportVersions.inspectionId, inspectionId),
            ))
            .orderBy(desc(reportVersions.versionNumber))
            .all();
        const amendmentTrail = {
            amended: versionRows.length > 1,
            latestVersion: versionRows[0]?.versionNumber ?? 0,
            versions: versionRows.map(v => ({
                versionNumber: v.versionNumber,
                publishedAt:   v.publishedAt,
                reason:        v.summary ?? null,
                isAmendment:   v.isAmendment,
            })),
        };

        // #119 — re-inspection context for the report page. When this
        // inspection is a re-inspection, the page renders only the carried
        // items with a left(original)/right(follow-up) layout. The status
        // catalog is the tenant's (falls back to defaults) so the follow-up
        // badge can resolve a human label from item.followupStatus.
        const reinspection = inspection.sourceInspectionId
            ? {
                round: inspection.reinspectionRound ?? 1,
                rootInspectionId: inspection.rootInspectionId,
                statuses: parseReinspectionStatuses(
                    (await db.select({ s: tenantConfigs.reinspectionStatuses })
                        .from(tenantConfigs)
                        .where(eq(tenantConfigs.tenantId, tenantId))
                        .get())?.s ?? null,
                ),
            }
            : null;

        // Layer-2 report signature + cryptographic verification metadata.
        // Both fields are null for draft/submitted reports; once published the
        // report page renders the inspector signature block and a verifiable QR.
        const isPublished = isReportPublished(inspection.reportStatus);

        // Extract _inspector_signature from the already-loaded results row.
        type InspectorSig = { signatureBase64?: string | null; signedAt?: number | null; userId?: string | null; auto?: boolean };
        const resultsData = resultsRow?.data as Record<string, unknown> | null | undefined;
        const rawSig = resultsData?._inspector_signature as InspectorSig | undefined;

        const signature = isPublished
            ? {
                signatureBase64: rawSig?.signatureBase64 ?? null,
                signedAt:        rawSig?.signedAt ?? null,
                inspectorName,
                inspectorLicense,
            }
            : null;

        let verification: { versionNumber: number; contentHash: string | null; verifyToken: string; publishedAt: number | null } | null = null;
        if (isPublished) {
            const vrow = await db.select({
                versionNumber:     reportVersions.versionNumber,
                contentHash:       reportVersions.contentHash,
                verificationToken: reportVersions.verificationToken,
                publishedAt:       reportVersions.publishedAt,
            }).from(reportVersions)
                .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
                .orderBy(desc(reportVersions.versionNumber))
                .limit(1)
                .get();
            if (vrow?.verificationToken) {
                verification = {
                    versionNumber: vrow.versionNumber,
                    contentHash:   vrow.contentHash ?? null,
                    verifyToken:   vrow.verificationToken,
                    publishedAt:   vrow.publishedAt ? Math.floor(vrow.publishedAt.getTime() / 1000) : null,
                };
            }
        }

        // Commercial PCA Phase M — ASTM E2018 compliance artifacts (sign-off,
        // PSQ, document review, computed conformance, and reliance text), gated
        // to full_pca so light/residential reports keep the fields
        // null/empty/seeded and pay no extra reads. Deviations reuse the same
        // `inspection.deviations` array `pcaReport` reads above (Phase S) — no
        // separate `.list()` call.
        const isFullPca = reportTier === 'full_pca';
        let astmConformance: AstmConformance | null = null;
        type RawReportSignoff = Awaited<ReturnType<ComplianceService['getCompliance']>>['reportSignoffs'][number];
        let reportSignoffs: Array<Omit<RawReportSignoff, 'signedAt'> & { signedAt: number }> = [];
        let psq: { status: string; responses: Record<string, unknown> | null } | null = null;
        let documentReview: Awaited<ReturnType<ComplianceService['getCompliance']>>['documentReview'] = [];
        let relianceText: typeof RELIANCE_TEMPLATES = { ...RELIANCE_TEMPLATES };
        if (isFullPca) {
            const compliance = new ComplianceService(this.db, this.encryptionSecret ?? '');
            const c = await compliance.getCompliance(tenantId, inspectionId);
            const deviations = (inspection as { deviations?: Deviation[] | null }).deviations ?? [];
            // `signedAt` is a drizzle `timestamp_ms` column — reads yield Date
            // instances at runtime. The wire contract (ReportSignoffView.signedAt
            // in app/components/portal/sections/report/types.ts) is epoch-ms
            // number; normalize here the same way the admin compliance route
            // does (server/api/inspections/compliance.ts's toMs/serializeSignoff)
            // so both paths agree on the wire shape.
            reportSignoffs = c.reportSignoffs.map((row) => ({
                ...row,
                signedAt: row.signedAt instanceof Date ? row.signedAt.getTime() : Number(row.signedAt),
            }));
            psq = c.psq ? { status: c.psq.status, responses: (c.psq.responses as Record<string, unknown> | null) ?? null } : null;
            documentReview = c.documentReview;
            astmConformance = computeConformance(deriveConformanceInput({
                reportSignoffs: c.reportSignoffs,
                deviations,
                psqStatus: c.psq?.status ?? null,
                psqDisclosedInDeviations: deviations.some((d) => d.area === 'PSQ'),
            }));
            // Phase S pca_narrative may carry inspector-edited reliance text;
            // fall back to the seeded ASTM boilerplate per-field.
            const narr = (inspection as { pcaNarrative?: { userReliance?: string; pointInTime?: string; siteSpecific?: string } }).pcaNarrative;
            relianceText = {
                userReliance: narr?.userReliance || RELIANCE_TEMPLATES.userReliance,
                pointInTime:  narr?.pointInTime  || RELIANCE_TEMPLATES.pointInTime,
                siteSpecific: narr?.siteSpecific || RELIANCE_TEMPLATES.siteSpecific,
            };
        }

        // Commercial PCA Phase U — per-unit payload. `unit_inspection_mode` is
        // Phase F's column (default 'tagged'); read defensively so this stays a
        // no-op until Phase F lands and for every non-per_unit inspection.
        const unitInspectionMode =
            (inspection as { unitInspectionMode?: 'tagged' | 'per_unit' | null }).unitInspectionMode ?? 'tagged';
        const unitRows = await db.select().from(inspectionUnits)
            .where(and(eq(inspectionUnits.tenantId, tenantId), eq(inspectionUnits.inspectionId, inspectionId)))
            .orderBy(asc(inspectionUnits.sortOrder)).all();
        // Only kind='unit' rows form matrix rows; buildings/floors are grouping.
        const matrixUnits = unitRows
            .filter((u) => u.kind === 'unit')
            .map((u) => ({ id: u.id, label: u.name }));
        const perUnit = unitInspectionMode === 'per_unit';
        // Pass the COMPLETE section id list so a per-unit finding in a section
        // that is not otherwise expanded still lands in the matrix.
        const sectionIds = sections.map((s) => s.id);
        const unitConditionMatrix = perUnit
            ? buildUnitConditionMatrix(matrixUnits, resultData as Record<string, unknown>, levels, sectionIds)
            : [];
        const unitDefectCounts = perUnit
            ? defectCountsByUnit(matrixUnits, resultData as Record<string, unknown>, levels)
            : {};

        return {
            inspection: { ...inspection, inspectorName },
            styleProfile: { ...styleProfile, tokens: styleProfile.tokens as Record<string, string> },
            inspectorCredentials: credentialSnapshot,
            amendmentTrail,
            reinspection,
            // DB-16 — resolved report cover image URL (cover_photo_id holds the
            // R2 key of an attached/pool photo). null when the inspector has not
            // picked a cover. The renderer consumes this directly.
            coverPhotoUrl: resolveCoverUrl(inspection as { coverImageKey?: string | null; coverPhotoId?: string | null }, makePhotoUrl),
            stats: { total: stats.total, satisfactory: stats.satisfactory, monitor: stats.monitor, defect: stats.defect },
            sections: numberedSections,
            // Commercial PCA Phase O — TOC projection (empty for residential/no-tier reports).
            outline,
            // Commercial PCA Phase P — photo presentation mode + the flat
            // centralized photo appendix (Appendix B). Computed unconditionally;
            // the renderer decides whether to display the appendix (mode === 'appendix').
            photoMode,
            photoAppendix,
            ratingLevels: levels.length > 0 ? levels : [
                { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good', isDefect: false },
                { id: 'Monitor', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal', isDefect: false },
                { id: 'Defect', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant', isDefect: true },
                { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'NI', color: '#3b82f6', severity: 'minor', isDefect: false },
            ],
            showEstimates,
            enableRepairList,
            enableCustomerRepairExport,
            reportTimeZone,
            propertyFacts,
            reportTier,
            costTables: resolvedCostTables,
            propertyType:        (inspection as { propertyType?: string | null }).propertyType ?? null,
            commercialSubtype:   (inspection as { commercialSubtype?: string | null }).commercialSubtype ?? null,
            buildingProfile,
            pcaReport,
            // Commercial PCA Phase U — per-unit inspection mode + the unit tree,
            // units×systems condition matrix, and per-unit defect counts. Matrix
            // and counts are empty in 'tagged' mode so the existing report renders
            // unchanged (additive fields only). Mode is also surfaced for the
            // Phase S walk-through narrative.
            unitInspectionMode,
            units: unitRows.map((u) => ({
                id: u.id, label: u.name, kind: u.kind, type: u.type,
                parentUnitId: u.parentUnitId, sortOrder: u.sortOrder, attrs: u.attrs ?? null,
            })),
            unitConditionMatrix,
            defectCountsByUnit: unitDefectCounts,
            samplingDeclaration: (inspection as { samplingDeclaration?: unknown }).samplingDeclaration ?? null,
            // Layer-2 report signature + verification (see docs/superpowers/specs/report-signature).
            isPublished,
            signature,
            verification,
            // Commercial PCA Phase M — ASTM compliance artifacts (full_pca only;
            // null/empty/seeded-default otherwise).
            astmConformance,
            reportSignoffs,
            psq,
            documentReview,
            relianceText,
        };
    }

    /**
     * Compute a stable content hash over the render inputs for an inspection
     * report. Used to skip Browser Rendering when identical-content PDFs are
     * already cached.
     *
     * Photo URLs use the raw R2 key (no volatile render/auth token) so the hash
     * is stable across token refreshes. Template CSS / layout changes are
     * covered by bumping RENDER_VERSION in server/lib/pdf.ts.
     *
     * Note: branding (logo image, primaryColor) is NOT included here because
     * it is not returned by getReportData — branding changes are instead
     * covered by bumping RENDER_VERSION.
     */
    async getReportContentHash(id: string, tenantId: string): Promise<string> {
        const data = await this.getReportData(id, tenantId, (key: string) => key);
        const payload = JSON.stringify({ v: RENDER_VERSION, data });
        return sha256Hex(payload);
    }

    /**
     * Layer ③ report-print footer context. Tenant-scoped lookup of the three
     * inputs the PDF running footer needs:
     *  - settings: resolved tenant PDF settings (showFooter/showPageNumbers/
     *    showLicense + companyAddress) from tenant_configs (default ON).
     *  - address: the inspection's property address (footer fallback when the
     *    tenant has no companyAddress configured).
     *  - license: the assigned inspector's users.licenseNumber (or null when no
     *    inspector is assigned / the user row carries no license).
     *
     * All reads are filtered by tenantId so a footer can never leak a foreign
     * tenant's address/license.
     */
    async getReportPdfFooterContext(
        id: string,
        tenantId: string,
    ): Promise<{ settings: PdfSettings; address: string; license: string | null }> {
        const db = drizzle(this.db);

        const insp = await db
            .select({ propertyAddress: inspections.propertyAddress, inspectorId: inspections.inspectorId })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();

        const cfg = await db
            .select({
                companyAddress: tenantConfigs.companyAddress,
                pdfShowFooter: tenantConfigs.pdfShowFooter,
                pdfShowPageNumbers: tenantConfigs.pdfShowPageNumbers,
                pdfShowLicense: tenantConfigs.pdfShowLicense,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        let license: string | null = null;
        if (insp?.inspectorId) {
            const owner = await db
                .select({ licenseNumber: users.licenseNumber })
                .from(users)
                .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId)))
                .get();
            license = owner?.licenseNumber ?? null;
        }

        return {
            settings: resolvePdfSettings(cfg),
            address: insp?.propertyAddress ?? '',
            license,
        };
    }
}
