/**
 * <ReportView> — the inspection report render, extracted from the standalone
 * route `app/routes/public/report-card-stack.tsx` so it can be rendered BOTH as
 * a standalone page AND inline inside the unified client-portal Hub (section ②).
 *
 * This component is data-source-agnostic: it receives everything via props (no
 * `useLoaderData`/`useParams`/`useSearchParams`). The route wrappers map their
 * loader payload through `reportViewProps()` and pass it in.
 *
 * The agent report (?view=agent) reuses the SAME standalone route, so it is
 * covered automatically by the wrapper — there is no separate agent component.
 *
 * The presentational sub-blocks (media tile / defect card / signature /
 * verification / repair panel) live colocated in ./report/*; the pure helpers
 * live in ~/lib/report-helpers. This file composes them and owns the report's
 * interactive state (filter, lightbox, repair selection, failed-photo Set).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useState } from "react";
import { m } from "~/paraglide/messages";
import { usePdfExport, pdfActionLabel, pdfBusyHint } from "~/hooks/usePdfExport";
import { brandFormat, brandTokens } from "~/lib/brand";
import { presetTokens } from "~/lib/report-style/preset-tokens";
import { formatInspectionDateTime } from "~/lib/format-date";
import { ErrorState } from "~/components/ErrorState";
import { itemDrivesSummary } from "~/lib/report-helpers";
import { ReportMediaTile } from "./report/ReportMediaTile";
import { CredentialBadges } from "./report/CredentialBadges";
import { badgeUrl } from "../../../../server/lib/media/badge-variant";
import { primaryBadgeOf } from "../../../../server/lib/credentials/primary";
import { ReportSectionBlock } from "./report/ReportSectionBlock";
import { PhotoAppendix } from "./report/PhotoAppendix";
import { ReportSignatureBlock } from "./report/ReportSignatureBlock";
import { ReportVerificationBlock } from "./report/ReportVerificationBlock";
import { ReportRepairPanel } from "./report/ReportRepairPanel";
import { BuildingProfile } from "./report/BuildingProfile";
import { PcaSkeleton } from "./report/PcaSkeleton";
import { ReportToc } from "./report/ReportToc";
import { PerUnitReportBlock } from "./report/PerUnitReportBlock";
import { CostTables } from "./report/CostTables";
import { WordExportButton } from "./report/WordExportButton";
import { CostExportButtons } from "~/components/CostExportButtons";
import {
  PRINT_CARD_CLASS,
  REPORT_HEADING_STYLE,
  type ReportPhoto,
  type FilterKey,
  type ReportLoaderResult,
} from "./report/types";

/* ------------------------------------------------------------------ */
/* Re-exports — keep ReportView's public type/constant/helper surface  */
/* identical after the structural split (route + tests import these).  */
/* ------------------------------------------------------------------ */

export type {
  ReportPhoto,
  ResolvedDefect,
  ReportItem,
  ReportSection,
  FilterKey,
  ReportSignature,
  ReportVerification,
  ReportLoaderResult,
} from "./report/types";
export {
  PRINT_CARD_CLASS,
  PRINT_FIGURE_CLASS,
  PRINT_SECTION_HEADING_CLASS,
  DEFECT_PHOTO_GRID_CLASS,
  ITEM_PHOTO_GRID_CLASS,
  printThumbWidth,
} from "./report/types";
export {
  signatureBlockModel,
  verificationBlockModel,
  type SignatureBlockResult,
  type VerificationBlockResult,
} from "~/lib/report-helpers";

/* ------------------------------------------------------------------ */
/* Component props + pure adapter */
/* ------------------------------------------------------------------ */

export interface ReportViewProps extends ReportLoaderResult {
  /** Route params, supplied by the wrapper (not from loader payload). */
  tenant: string;
  /** The inspection id (params); falls back to loader inspectionId. */
  reportId: string;
  /** Public access token (?token=) used for token-scoped action links. */
  token?: string;
  /**
   * When true (the STANDALONE `/report-view/...` page) the component renders its
   * own full-page chrome: a `min-h-screen` page background and the big property-
   * ADDRESS title block. When false (default — rendered INLINE inside the Hub)
   * that chrome is dropped: the Hub already supplies the page container, header
   * and address, so the bare report content is rendered to avoid a double
   * background and a duplicated address. The functional bits (filters, toolbar,
   * Download-PDF FAB, signature/verification, lightbox) render in BOTH modes.
   * Mirrors `PaymentSection`'s `showStandaloneChrome` convention.
   */
  showStandaloneChrome?: boolean;
  /** Spec 3: hide client-transaction affordances (repair-list / build-repair
   *  links + the in-report Repair Request toggle) when an AGENT is viewing the
   *  report via their link. Report-viewing actions (Print, Download PDF) stay. */
  hideClientActions?: boolean;
}

/**
 * Pure adapter: loader payload (+ route params) → component props. Unit-testable
 * (no React / router). Defensive defaults keep it safe against partial payloads.
 */
export function reportViewProps(
  data: ReportLoaderResult & {
    tenant?: string;
    inspectionId?: string;
    token?: string;
    showStandaloneChrome?: boolean;
  },
): ReportViewProps {
  const reportId = data.inspectionId ?? "";
  return {
    inspectionId: data.inspectionId ?? "",
    address: data.address ?? "",
    date: data.date ?? "",
    inspectorName: data.inspectorName ?? null,
    coverPhotoUrl: data.coverPhotoUrl ?? null,
    stats: data.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
    sections: data.sections ?? [],
    outline: data.outline ?? [],
    showEstimates: data.showEstimates ?? false,
    costTables: data.costTables ?? null,
    enableRepairList: data.enableRepairList ?? false,
    enableCustomerRepairExport: data.enableCustomerRepairExport ?? false,
    reportTimeZone: data.reportTimeZone ?? "UTC",
    isDelivered: data.isDelivered ?? false,
    brand: data.brand,
    error: data.error ?? null,
    notPublished: data.notPublished ?? false,
    linkInactive: data.linkInactive ?? false,
    styleProfile: data.styleProfile,
    inspectorCredentials: data.inspectorCredentials,
    initialFilter: data.initialFilter ?? "all",
    printMode: data.printMode ?? false,
    tocPages: data.tocPages,
    isPublished: data.isPublished ?? false,
    signature: data.signature ?? null,
    verification: data.verification ?? null,
    astmConformance: data.astmConformance ?? null,
    reportSignoffs: data.reportSignoffs ?? [],
    psq: data.psq ?? null,
    documentReview: data.documentReview ?? [],
    relianceText: data.relianceText ?? { userReliance: "", pointInTime: "", siteSpecific: "" },
    ownerPreview: data.ownerPreview ?? false,
    baseUrl: data.baseUrl ?? "",
    photoMode: data.photoMode ?? "inline",
    photoAppendix: data.photoAppendix ?? [],
    propertyType: data.propertyType ?? null,
    commercialSubtype: data.commercialSubtype ?? null,
    reportTier: data.reportTier ?? null,
    buildingProfile: data.buildingProfile ?? [],
    pcaReport: data.pcaReport ?? null,
    unitInspectionMode: data.unitInspectionMode ?? "tagged",
    units: data.units ?? [],
    unitConditionMatrix: data.unitConditionMatrix ?? [],
    defectCountsByUnit: data.defectCountsByUnit ?? {},
    tenant: data.tenant ?? "",
    reportId,
    token: data.token,
    showStandaloneChrome: data.showStandaloneChrome ?? false,
  };
}

/* ------------------------------------------------------------------ */
/* Image fallbacks (Plan 1 / N1)                                       */
/* ------------------------------------------------------------------ */

/**
 * Restrained fallback shown in place of the report cover photo when the
 * underlying image fails to load (e.g. the photo was removed after the
 * report was published). We render a calm panel rather than hiding the
 * cover section, so the report never looks half-broken to the client.
 */
function CoverPhotoPlaceholder() {
  return (
    <div className="w-full h-44 sm:h-56 rounded-xl border border-ih-border bg-ih-bg-muted flex flex-col items-center justify-center gap-2 text-ih-fg-4">
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span className="text-xs font-medium tracking-wide">{m.report_view_cover_unavailable()}</span>
    </div>
  );
}

/**
 * React key for a media tile. Videos key on their stream/media id (stable across
 * reorders); photos key on their storage key. Pulled out of the JSX because the
 * inline form was a five-deep nested ternary.
 */
function mediaTileKey(photo: ReportPhoto, idx: number): string {
  const media = photo.media;
  switch (media?.kind) {
    case "video-player":
      return `v-${media.streamUid}-${idx}`;
    case "video-poster":
      return `vp-${media.streamUid}-${idx}`;
    case "r2-video-player":
      return `r2v-${media.mediaId}-${idx}`;
    case "r2-video-poster":
      return `r2vp-${media.mediaId}-${idx}`;
    default:
      return photo.key;
  }
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function ReportView(props: ReportViewProps) {
  const data = props;
  const tenant = props.tenant;
  const id = props.reportId || data.inspectionId;
  const urlToken = props.token;
  // Standalone page = full chrome (page background + big address title block).
  // Inline in the Hub (default) = bare: the Hub supplies the page container,
  // header and address, so we drop the page shell + duplicate address title.
  const standalone = props.showStandaloneChrome ?? false;

  const [filter, setFilter] = useState<FilterKey>(data.initialFilter ?? "all");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [repairPanel, setRepairPanel] = useState(false);
  const [repairItems, setRepairItems] = useState<Record<string, boolean>>({});
  // Browser Rendering rate-limit UX (shared across every BR-backed PDF surface).
  const pdf = usePdfExport();
  const [coverFailed, setCoverFailed] = useState(false);

  // Photo keys whose thumbnail failed to load. A failed thumbnail is collapsed
  // (rendered as null) rather than showing the browser's broken-image glyph,
  // keeping the client report clean even after upstream photos are removed.
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());
  const markPhotoFailed = (key: string) =>
    setFailedPhotos((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

  // Plan 7 — render one media tile (photo OR video) through <ReportMediaTile>.
  // The web report → lazy Stream <iframe>; PDF render path → poster <img> + QR;
  // photo / legacy / no-subdomain fall through to the existing <img> with its
  // onError/failedPhotos/aspect-[4/3]/alt hardening intact.
  const renderMediaTile = (photo: ReportPhoto, alt: string, idx: number) => (
    <ReportMediaTile
      key={mediaTileKey(photo, idx)}
      photo={photo}
      alt={alt}
      idx={idx}
      printMode={data.printMode}
      onOpenLightbox={setLightboxUrl}
      onPhotoFailed={markPhotoFailed}
    />
  );

  /** A media entry is "visible" when it is a video OR a photo whose thumb hasn't failed. */
  const mediaVisible = (p: ReportPhoto) => p.media?.kind === "video-player" || p.media?.kind === "video-poster" || p.media?.kind === "r2-video-player" || p.media?.kind === "r2-video-poster" || !failedPhotos.has(p.key);

  // Dynamic rating summary — derived from THIS inspection's own rating system
  // (Spectora-style) instead of fixed Satisfactory/Monitor/Defects buckets.
  // Tally items by their rating level and render one card per level present,
  // using the level's own label + color, ordered good→bad by severity bucket.
  const BUCKET_RANK: Record<string, number> = { satisfactory: 0, monitor: 1, defect: 2, other: 3 };
  const ratingTally = new Map<string, { label: string; color: string; bucket: string; count: number; seen: number }>();
  let seenOrder = 0;
  for (const it of data.sections.flatMap((s) => s.items)) {
    if (!it.rating) continue;
    const ex = ratingTally.get(it.rating);
    if (ex) ex.count++;
    else ratingTally.set(it.rating, { label: it.ratingLabel ?? it.rating, color: it.ratingColor, bucket: it.severityBucket, count: 1, seen: seenOrder++ });
  }
  const summaryCards: Array<{ label: string; value: number; color: string | null }> = [
    { label: m.report_view_stat_total(), value: data.stats.total, color: null },
    ...[...ratingTally.values()]
      .sort((a, b) => (BUCKET_RANK[a.bucket] ?? 9) - (BUCKET_RANK[b.bucket] ?? 9) || a.seen - b.seen)
      .map((l) => ({ label: l.label, value: l.count, color: l.color })),
  ];

  const downloadPdf = () => {
    const url = urlToken
      ? `/api/public/report/${tenant}/${id}/pdf?type=full&token=${encodeURIComponent(urlToken)}`
      : `/api/inspections/${id}/pdf?type=full`;
    void pdf.exportPdf(url, { filename: `report-${id}.pdf` });
  };

  if (data.error) {
    if (data.notPublished) {
      return (
        <ErrorState
          title={m.report_view_not_published_title()}
          message={m.report_view_not_published_message()}
        />
      );
    }
    // IA-36 ⑨ — "we took this link offline" (410) and "this link names nothing"
    // (404) render the SAME page on purpose.
    //
    // The reader cannot act on the difference and we cannot always tell them
    // the truth anyway: rotating a link overwrites its row in place, so a
    // recipient holding the superseded URL is indistinguishable from someone
    // who mistyped one — both arrive as 404. Splitting the copy would mean
    // confidently telling a legitimate client "no such report" when we in fact
    // replaced their link ten minutes ago.
    //
    // So the page states both possibilities and names the recovery path. The
    // wire keeps 410 and 404 distinct — support and the audit trail need to
    // know which happened even when the reader doesn't.
    const notFound = data.error === "Report not found";
    if (notFound || data.linkInactive) {
      // Name the company and give a channel. "Ask your inspector" is not
      // actionable to someone who received one email months ago and no longer
      // remembers who sent it.
      const company = data.brand?.companyName;
      return (
        <ErrorState
          title={m.report_link_inactive_title()}
          message={
            company
              ? m.report_link_inactive_message_company({ company })
              : m.report_link_inactive_message()
          }
          contacts={{
            email: data.brand?.supportEmail,
            phone: data.brand?.companyPhone,
          }}
        />
      );
    }
    return (
      <ErrorState
        title={m.report_view_unavailable_title()}
        message={m.report_view_load_error()}
      />
    );
  }

  const toggleRepairItem = (itemId: string) => {
    setRepairItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const selectedRepairList = data.sections
    .flatMap((s) => s.items)
    .filter((item) => repairItems[item.id]);

  const filteredSections =
    filter === "defects"
      ? data.sections
          .filter((s) => s.defectCount > 0)
          .map((s) => ({
            ...s,
            items: s.items.filter((i) => itemDrivesSummary(i)),
          }))
      : data.sections;

  return (
    <div className={standalone ? "min-h-screen bg-ih-bg-card" : undefined} data-report-profile={data.styleProfile?.id || undefined} style={{ ...brandTokens(data.brand.primaryColor), ...presetTokens(data.styleProfile?.tokens) }}>
      {/* Download PDF FAB + Export to Word (Commercial PCA Phase W Task 6 —
          owner-only, commercial reports only; the public token viewer never
          has ownerPreview true, and `<ReportView>` is rendered standalone in
          plenty of router-less unit tests, so <WordExportButton> — which
          calls useFetcher() and therefore requires a data-router context —
          is only mounted into the tree at all when the gate is satisfied,
          rather than always-mounted-but-internally-hidden. */}
      <div className="print:hidden fixed bottom-6 right-6 z-50 flex flex-wrap items-center justify-end gap-2 max-w-[calc(100vw-3rem)]">
        {/* Cost export (Commercial PCA) — owner-preview only, commercial reports
            with at least one cost table row. Public token viewers never have
            ownerPreview, residential reports have no reportTier, and reports
            with zero cost items have no costTables — so all three are hidden. */}
        {Boolean(data.ownerPreview) && Boolean(data.reportTier) && data.costTables ? (
          <CostExportButtons inspectionId={data.inspectionId} variant="fab" />
        ) : null}
        {Boolean(data.ownerPreview) && Boolean(data.reportTier) ? (
          <WordExportButton inspectionId={data.inspectionId} />
        ) : null}
        <div className="flex flex-col items-end gap-2">
          {pdf.error || pdf.generating ? (
            <div
              role="status"
              className="max-w-[15rem] rounded-lg bg-ih-bg-inverse px-3 py-2 text-[11px] font-medium leading-snug text-ih-fg-inverse shadow-ih-popover"
            >
              {pdf.error ?? pdfBusyHint()}
            </div>
          ) : null}
          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdf.busy}
            className="px-5 py-3 rounded-full bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest shadow-ih-popover hover:bg-ih-primary transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            {pdfActionLabel(pdf, m.report_view_download_pdf())}
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            {data.brand.logoUrl ? (
              <img src={data.brand.logoUrl} alt={data.brand.companyName ?? m.report_view_logo_alt()} className="h-10 w-auto" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-ih-ok/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-ih-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            )}
            <span className="text-xs font-semibold tracking-widest uppercase text-ih-fg-4">
              {data.brand.companyName ? m.report_view_cert_with_company({ company: data.brand.companyName }) : m.report_view_cert()}
            </span>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {/* IA-68 — the "View Repair List" button pointed at
                /inspections/:id/repair-list, a page route that does not exist
                (only the API route does), so it 404'd. The "Build repair
                request" button below already reaches the real repair capability;
                the dead affordance is removed rather than pointed somewhere new. */}
            {!data.hideClientActions && data.enableCustomerRepairExport && (
              <a
                href={`/repair-builder/${tenant}/${id}${urlToken ? `?token=${encodeURIComponent(urlToken)}` : ""}`}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
              >
                {m.report_view_build_repair()}
              </a>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
            >
              {m.report_view_print()}
            </button>
            {!data.hideClientActions && (
              <button
                type="button"
                onClick={() => setRepairPanel(!repairPanel)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-ih-primary-fg flex items-center gap-2"
              >
                {m.portal_hub_nav_repair()}
              </button>
            )}
          </div>
        </div>
        {/* Big property-ADDRESS title — standalone only. Inline in the Hub the
            page header already shows the address + date, so rendering it again
            here would duplicate the address. The inspector/date cert line below
            stays in both modes (functional, not chrome). */}
        {standalone && (
          <h1 className="text-2xl sm:text-3xl leading-tight mb-2 text-ih-fg-1" style={REPORT_HEADING_STYLE}>
            {data.address}
          </h1>
        )}
        <p className="text-sm text-ih-fg-3">
          {data.date ? `${formatInspectionDateTime(data.date, undefined, data.reportTimeZone, brandFormat(data.brand))} · ` : ""}
          {m.report_view_inspector({ name: data.inspectorName || m.report_view_na() })}
        </p>
        {data.inspectorCredentials && data.inspectorCredentials.length > 0 && (
          <CredentialBadges credentials={data.inspectorCredentials} layout={data.styleProfile?.badgeLayout ?? "strip"} />
        )}
      </div>

      {/* Cover photo (DB-16) — the inspector-chosen report cover image. On load
          failure (e.g. the photo was removed after publish) we swap in a restrained
          placeholder rather than hiding the section, so the report never looks
          broken to the client (Plan 1 / N1). */}
      {data.coverPhotoUrl && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
          {coverFailed ? (
            <CoverPhotoPlaceholder />
          ) : (
            <img
              src={`${data.coverPhotoUrl}&w=1600`}
              alt={`Cover photo — ${data.address}`}
              // Fixed height (matching CoverPhotoPlaceholder) reserves the banner
              // box before the image loads, so it never reflows content downward
              // on load (no CLS) and the loaded/error states share one layout.
              className="h-44 w-full sm:h-56 object-cover rounded-xl border border-ih-border"
              loading={data.printMode ? "eager" : "lazy"}
              onError={() => setCoverFailed(true)}
            />
          )}
        </div>
      )}

      {/* Stats — Commercial PCA Phase O: this at-a-glance block is the report's
          "PCA Summary" front-matter page (registry id `pca-summary`), so it
          carries that anchor for the TOC / PDF bookmarks. It renders
          unconditionally (data.stats always present), so the anchor is never
          dangling regardless of tier. */}
      <div id="pca-summary" className="max-w-4xl mx-auto px-4 sm:px-6 mb-6 scroll-mt-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summaryCards.map((s) => (
            <div key={s.label} className={`bg-ih-bg-card border border-ih-border rounded-lg p-4 text-center ${PRINT_CARD_CLASS}`}>
              <div className={`text-2xl font-bold ${s.color ? "" : "text-ih-fg-1"}`} style={s.color ? { color: s.color } : undefined}>{s.value}</div>
              <div className="text-[11px] text-ih-fg-4 uppercase tracking-widest mt-1">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Building Profile — Commercial PCA Phase F */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <BuildingProfile rows={data.buildingProfile ?? []} />
      </div>

      {/* Filter chips */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-8 print:hidden">
        <div className="flex gap-2">
          {(["all", "defects", "summary"] as FilterKey[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                filter === f
                  ? "bg-ih-primary text-ih-primary-fg"
                  : "border border-ih-border text-ih-fg-3"
              }`}
            >
              {f === "all" ? m.report_view_filter_all() : f === "defects" ? m.report_view_filter_defects() : m.report_view_filter_summary()}
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className={`max-w-4xl mx-auto px-4 sm:px-6 ${repairPanel ? "pb-[65vh]" : "pb-32"}`}>
        {/* PCA Skeleton — Commercial PCA Phase S front matter. data.pcaReport is
            null for non-commercial reports (server gates it in getReportData), so
            PcaSkeleton renders nothing on residential home inspections. The
            compliance prop (Phase M) feeds the conformance/signoff/doc-review/
            PSQ/reliance slots inside it; every field is empty/null-safe so it
            only ever adds content when the skeleton itself is already rendering. */}
        {/* Commercial PCA Phase O — reserved TOC slot: after the cover/header
            front matter, before the PcaSkeleton body. `?? []` guards the
            inline-Hub mount that may pass a partial payload during
            transition; ReportToc itself renders nothing when empty.
            Task 19a — `tocPages` (undefined on the web + PDF pass 1) fills the
            reserved page-ref slot with real page numbers on pass 2, resolved
            server-side by extractAnchorPages against the pass-1 render. */}
        <ReportToc entries={data.outline ?? []} tocPages={data.tocPages} />
        <PcaSkeleton
          data={data.pcaReport ?? null}
          tier={data.reportTier ?? null}
          reportTimeZone={data.reportTimeZone}
          compliance={{
            conformance: data.astmConformance ?? null,
            signoffs: data.reportSignoffs ?? [],
            psq: data.psq ?? null,
            documentReview: data.documentReview ?? [],
            relianceText: data.relianceText ?? { userReliance: "", pointInTime: "", siteSpecific: "" },
          }}
        />
        {/* Commercial PCA Phase U — per-unit matrix + exception detail (gated on
            per_unit mode; renders nothing otherwise → report byte-identical). */}
        <PerUnitReportBlock data={data} />
        {filteredSections.map((section, sectionIdx) => (
          <ReportSectionBlock
            key={section.id}
            section={section}
            sectionIdx={sectionIdx}
            filter={filter}
            showEstimates={data.showEstimates}
            showPhotos={data.photoMode !== "appendix"}
            mediaVisible={mediaVisible}
            renderMediaTile={renderMediaTile}
            repairItems={repairItems}
            onToggleRepairItem={toggleRepairItem}
          />
        ))}

        {/* Commercial PCA Phase C — TABLE 1 (Opinion of Cost) + opt-in TABLE 2
            (Reserve Schedule), following the body per the real-PCA layout.
            Phase T seam: today gated on `showEstimates`; when report_tier
            lands, gate on `reportTier === 'full_pca' || (reportTier ===
            'light_commercial' && showEstimates)` instead. */}
        <CostTables data={data.costTables ?? null} show={data.showEstimates} isPrint={data.printMode} />
      </div>

      {/* Commercial PCA Phase P — Appendix B: centralized numbered photo
          appendix. Mounted once at the end of the report body (after every
          section + the cost tables, before signature/verification) so it
          reads as the report's final content block, matching the real-PCA
          layout. Suppressed entirely (renders null) outside 'appendix' mode. */}
      {data.photoMode === "appendix" && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
          <PhotoAppendix photos={data.photoAppendix ?? []} isPrint={data.printMode} />
        </div>
      )}

      {/* ── Signature block ──────────────────────────────────────────────
          The cover strip above shows EVERY badge; this has room for one, and
          `primaryBadgeOf` is where that choice is stated — first badge in the
          inspector's own order, the same list they reorder in Licenses &
          affiliations. It used to be an inline `.find()` here, which made the
          answer an accident of sort order that nobody could aim at. */}
      <ReportSignatureBlock isPublished={data.isPublished} signature={data.signature} ownerPreview={data.ownerPreview} timeZone={data.reportTimeZone} credentialBadgeUrl={badgeUrl(primaryBadgeOf(data.inspectorCredentials ?? []), "reportSignature")} />

      {/* ── Verification block ───────────────────────────────────────── */}
      <ReportVerificationBlock verification={data.verification} baseUrl={data.baseUrl} timeZone={data.reportTimeZone} />

      {/* Repair Request Panel */}
      {repairPanel && (
        <ReportRepairPanel
          selectedRepairList={selectedRepairList}
          showEstimates={data.showEstimates}
          onClose={() => setRepairPanel(false)}
        />
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          /* ds-allow: customer report render surface, not app chrome — fixed-dark image lightbox */
          className="fixed inset-0 z-[60] bg-[rgba(15,23,42,0.9)] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
