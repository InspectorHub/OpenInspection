import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc } from 'drizzle-orm';
import { inspections, inspectionResults, templates, users, tenantConfigs, reportVersions } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { parseReinspectionStatuses } from '../../lib/reinspection-status';
import { computeReportStats, getRatingColor, getRatingBucket, mapCustomDefectsForReport, type RatingLevel } from '../../lib/report-utils';
import { mapRatingSystemLevels } from '../../lib/map-rating-levels';
import { renderTemplate } from '../../lib/mustache';
import { mapRepairItems } from '../../lib/report-repair-items';
import { selectReportMedia, type ReportMediaContext } from '../../lib/report-video';
import { findingKey, DEFAULT_UNIT } from '../../lib/finding-key';
import { sha256Hex } from '../signing-key.service';
import { RENDER_VERSION } from '../../lib/pdf';
import { resolvePdfSettings, type PdfSettings } from '../../lib/pdf-settings';
import { isReportPublished } from '../../lib/status/report-status';
import type { DefectCommentState } from '../../types/inspection-item-state';
import { resolveCoverUrl, resolveDefectMustacheVars, RECOMMENDATION_CATEGORY_LABELS } from './shared';
import { InspectionSubService } from './base';
import type {
    PhotoEntry,
    CannedState,
    DefectState,
    ResultsProjection,
} from '../../lib/collab/results-doc.types';

/**
 * Report data aggregation: getReportData (the resolved, render-ready report
 * shape), its stable content hash, and the PDF footer context. Extracted
 * verbatim from InspectionService. getReportContentHash calls getReportData
 * internally (same service).
 */
export class InspectionReportService extends InspectionSubService {
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
        interface CannedDefect      { id: string; title: string; category: 'maintenance' | 'recommendation' | 'safety'; location: string; comment: string; photos: string[]; default: boolean }
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
                    return {
                        ...d,
                        included,
                        effectiveComment: renderTemplate(override ?? d.comment, resolveDefectMustacheVars(st as DefectCommentState | undefined, d as CannedDefect, res.attributes)),
                        effectiveCategory: st?.category ?? d.category,
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
                );

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

        let inspectorName: string | null = null;
        let inspectorLicense: string | null = null;
        if (inspection.inspectorId) {
            const inspector = await db.select({ name: users.name, email: users.email, licenseNumber: users.licenseNumber })
                .from(users).where(eq(users.id, inspection.inspectorId)).get();
            inspectorName = inspector?.name || (inspector?.email?.split('@')[0] ?? null);
            inspectorLicense = inspector?.licenseNumber ?? null;
        }

        // Sprint 2 S2-4 — per-tenant flag controls whether the published
        // report renders "Estimated cost: $X – $Y" badges on defect cards.
        let showEstimates = false;
        let reportTheme: 'modern' | 'classic' | 'minimal' = 'modern';
        // Per-tenant report-feature flags surfaced to the published report so the
        // client report can render the "View Repair List" and "Build repair request"
        // entries. Read live here (not part of the cached report content).
        let enableRepairList = false;
        let enableCustomerRepairExport = false;
        try {
            const cfg = await db.select({
                showEstimates: tenantConfigs.showEstimates,
                reportTheme:   tenantConfigs.reportTheme,
                enableRepairList: tenantConfigs.enableRepairList,
                enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport,
            })
                .from(tenantConfigs)
                .where(eq(tenantConfigs.tenantId, tenantId))
                .get();
            if (cfg) {
                showEstimates = Boolean(cfg.showEstimates);
                enableRepairList = Boolean(cfg.enableRepairList);
                enableCustomerRepairExport = Boolean(cfg.enableCustomerRepairExport);
                if (cfg.reportTheme === 'classic' || cfg.reportTheme === 'minimal') {
                    reportTheme = cfg.reportTheme;
                }
            }
        } catch {
            // tenant_configs row missing — defaults apply.
        }
        // Per-inspection override wins over tenant default.
        const inspectionThemeOverride = (inspection as { reportThemeOverride?: string | null }).reportThemeOverride;
        if (inspectionThemeOverride === 'classic' || inspectionThemeOverride === 'minimal') {
            reportTheme = inspectionThemeOverride;
        } else if (inspectionThemeOverride === 'modern') {
            reportTheme = 'modern';
        }

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
                    publishedAt:   vrow.publishedAt ?? null,
                };
            }
        }

        return {
            inspection: { ...inspection, inspectorName },
            theme: reportTheme,
            amendmentTrail,
            reinspection,
            // DB-16 — resolved report cover image URL (cover_photo_id holds the
            // R2 key of an attached/pool photo). null when the inspector has not
            // picked a cover. The renderer consumes this directly.
            coverPhotoUrl: resolveCoverUrl(inspection as { coverImageKey?: string | null; coverPhotoId?: string | null }, makePhotoUrl),
            stats: { total: stats.total, satisfactory: stats.satisfactory, monitor: stats.monitor, defect: stats.defect },
            sections,
            ratingLevels: levels.length > 0 ? levels : [
                { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good', isDefect: false },
                { id: 'Monitor', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal', isDefect: false },
                { id: 'Defect', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant', isDefect: true },
                { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'NI', color: '#3b82f6', severity: 'minor', isDefect: false },
            ],
            showEstimates,
            enableRepairList,
            enableCustomerRepairExport,
            propertyFacts,
            // Layer-2 report signature + verification (see docs/superpowers/specs/report-signature).
            isPublished,
            signature,
            verification,
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
