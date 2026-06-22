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
import { brandTokens } from "~/lib/brand";
import { ErrorState } from "~/components/ErrorState";
import { getSectionIcon, isDefect } from "~/lib/report-helpers";
import { ReportMediaTile } from "./report/ReportMediaTile";
import { ReportDefectCard } from "./report/ReportDefectCard";
import { ReportSignatureBlock } from "./report/ReportSignatureBlock";
import { ReportVerificationBlock } from "./report/ReportVerificationBlock";
import { ReportRepairPanel } from "./report/ReportRepairPanel";
import {
  PRINT_CARD_CLASS,
  PRINT_SECTION_HEADING_CLASS,
  ITEM_PHOTO_GRID_CLASS,
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
    showEstimates: data.showEstimates ?? false,
    enableRepairList: data.enableRepairList ?? false,
    enableCustomerRepairExport: data.enableCustomerRepairExport ?? false,
    isDelivered: data.isDelivered ?? false,
    brand: data.brand,
    error: data.error ?? null,
    notPublished: data.notPublished ?? false,
    reportTheme: data.reportTheme,
    initialFilter: data.initialFilter ?? "all",
    printMode: data.printMode ?? false,
    isPublished: data.isPublished ?? false,
    signature: data.signature ?? null,
    verification: data.verification ?? null,
    ownerPreview: data.ownerPreview ?? false,
    baseUrl: data.baseUrl ?? "",
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
      <span className="text-xs font-medium tracking-wide">Cover photo unavailable</span>
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
  const [generating, setGenerating] = useState(false);
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
    { label: "Total", value: data.stats.total, color: null },
    ...[...ratingTally.values()]
      .sort((a, b) => (BUCKET_RANK[a.bucket] ?? 9) - (BUCKET_RANK[b.bucket] ?? 9) || a.seen - b.seen)
      .map((l) => ({ label: l.label, value: l.count, color: l.color })),
  ];

  const downloadPdf = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const url = urlToken
        ? `/api/public/report/${tenant}/${id}/pdf?type=full&token=${encodeURIComponent(urlToken)}`
        : `/api/inspections/${id}/pdf?type=full`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `report-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  if (data.error) {
    if (data.notPublished) {
      return (
        <ErrorState
          title="This report is not published"
          message="This report is not published. Please contact your inspector if you believe this is a mistake."
        />
      );
    }
    const notFound = data.error === "Report not found";
    return (
      <ErrorState
        title={notFound ? "Report not found" : "Report unavailable"}
        message={
          notFound
            ? "This report link is invalid or has expired. Please contact your inspector for an up-to-date link."
            : "We couldn't load this report right now. Please try again in a moment."
        }
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
            items: s.items.filter((i) => isDefect(i.severityBucket)),
          }))
      : data.sections;

  return (
    <div className={standalone ? "min-h-screen bg-ih-bg-card" : undefined} data-theme={data.reportTheme || undefined} style={brandTokens(data.brand.primaryColor)}>
      {/* Download PDF FAB */}
      <button
        type="button"
        onClick={downloadPdf}
        disabled={generating}
        className="print:hidden fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest shadow-ih-popover hover:bg-ih-primary transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
        {generating ? "Generating…" : "Download PDF"}
      </button>

      {/* Header */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            {data.brand.logoUrl ? (
              <img src={data.brand.logoUrl} alt={data.brand.siteName ?? "Logo"} className="h-10 w-auto" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-ih-ok/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-ih-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            )}
            <span className="text-xs font-semibold tracking-widest uppercase text-ih-fg-4">
              {data.brand.siteName ? `${data.brand.siteName} · Certified Inspection Report` : "Certified Inspection Report"}
            </span>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {data.enableRepairList && (
              <a
                href={`/inspections/${data.inspectionId}/repair-list`}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
              >
                View Repair List
              </a>
            )}
            {data.enableCustomerRepairExport && (
              <a
                href={`/repair-builder/${tenant}/${id}${urlToken ? `?token=${encodeURIComponent(urlToken)}` : ""}`}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
              >
                Build repair request
              </a>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
            >
              Print
            </button>
            <button
              type="button"
              onClick={() => setRepairPanel(!repairPanel)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-ih-primary-fg flex items-center gap-2"
            >
              Repair Request
            </button>
          </div>
        </div>
        {/* Big property-ADDRESS title — standalone only. Inline in the Hub the
            page header already shows the address + date, so rendering it again
            here would duplicate the address. The inspector/date cert line below
            stays in both modes (functional, not chrome). */}
        {standalone && (
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-2 text-ih-fg-1">
            {data.address}
          </h1>
        )}
        <p className="text-sm text-ih-fg-3">
          {data.date} &middot; Inspector: {data.inspectorName || "N/A"}
        </p>
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
              className="w-full max-h-72 object-cover rounded-xl border border-ih-border"
              loading={data.printMode ? "eager" : "lazy"}
              onError={() => setCoverFailed(true)}
            />
          )}
        </div>
      )}

      {/* Stats */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
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
              {f === "all" ? "All" : f === "defects" ? "Defects Only" : "Summary"}
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className={`max-w-4xl mx-auto px-4 sm:px-6 ${repairPanel ? "pb-[65vh]" : "pb-32"}`}>
        {filteredSections.map((section, sectionIdx) => {
          if (filter === "defects" && section.items.length === 0) return null;
          return (
            <div key={section.id} className="mb-6 group/section relative">
              <div className={`flex items-center gap-3 mb-4 ${PRINT_SECTION_HEADING_CLASS}`}>
                <span className="text-2xl">{getSectionIcon(section.title)}</span>
                <h2 className="text-2xl font-bold italic text-ih-fg-1">
                  <span className="font-mono not-italic mr-1 text-ih-fg-4">
                    {sectionIdx + 1} -
                  </span>
                  {section.title}
                </h2>
                <div className="flex-1 h-px border-t border-ih-border" />
                <span className="text-xs font-mono text-ih-fg-4">
                  {section.items.length} items
                </span>
              </div>

              {/* Items (hidden in summary mode) */}
              {filter !== "summary" && (
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden ${PRINT_CARD_CLASS}`}
                      style={{ borderLeftWidth: 4, borderLeftColor: item.ratingColor }}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-semibold text-ih-fg-1">
                            {item.label}
                          </h3>
                          {item.ratingLabel && (
                            <span
                              className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                              style={{
                                background: `${item.ratingColor}20`,
                                color: item.ratingColor,
                              }}
                            >
                              {item.ratingLabel}
                            </span>
                          )}
                        </div>

                        {/* Non-rich item value */}
                        {item.type &&
                          item.type !== "rich" &&
                          item.value !== undefined &&
                          item.value !== null &&
                          item.value !== "" && (
                            <p className="mt-2 text-sm font-semibold text-ih-fg-1">
                              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mr-2">
                                {item.type}
                              </span>
                              {Array.isArray(item.value)
                                ? (item.value as unknown[]).join(" · ")
                                : item.type === "boolean"
                                ? (item.value as boolean)
                                  ? "Yes"
                                  : "No"
                                : String(item.value)}
                              {item.unit && (
                                <span className="text-ih-fg-4 ml-1.5">
                                  {item.unit}
                                </span>
                              )}
                            </p>
                          )}

                        {item.notes && (
                          <p className="text-sm text-ih-fg-3 mt-2 leading-relaxed">
                            {item.notes}
                          </p>
                        )}

                        {/* FE-3/B-20 — findings: included canned + custom defects with their
                        own photos. Previously the viewer rendered neither (field-authored
                        defects never appeared in the published report at all). */}
                        <ReportDefectCard item={item} mediaVisible={mediaVisible} renderMediaTile={renderMediaTile} />

                        {item.recommendation && (
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg uppercase">
                              Recommend: {item.recommendation}
                            </span>
                            {data.showEstimates &&
                              (item.estimateMin != null || item.estimateMax != null) && (
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
                                  Estimated cost: $
                                  {item.estimateMin?.toLocaleString() ?? "?"} - $
                                  {item.estimateMax?.toLocaleString() ?? "?"}
                                </span>
                              )}
                          </div>
                        )}

                        {(item.repairItems?.length ?? 0) > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {item.repairItems!.map((ri, i) => (
                              <div key={i} className="flex items-center gap-2 flex-wrap text-[12px]">
                                <span className="font-semibold text-ih-fg-2">{ri.summary}</span>
                                {ri.contractorType && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg uppercase">{ri.contractorType}</span>
                                )}
                                {data.showEstimates && (ri.estimateMin != null || ri.estimateMax != null) && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
                                    ${ri.estimateMin?.toLocaleString() ?? "?"} – ${ri.estimateMax?.toLocaleString() ?? "?"}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {item.photos.filter(mediaVisible).length > 0 && (
                          <div className={`mt-3 ${ITEM_PHOTO_GRID_CLASS}`}>
                            {item.photos
                              .filter(mediaVisible)
                              .map((photo, idx) => renderMediaTile(photo, `${item.label} — photo ${idx + 1}`, idx))}
                          </div>
                        )}

                        {(item.severityBucket === "defect" ||
                          item.severityBucket === "monitor") && (
                          <label className="print:hidden flex items-center gap-2 mt-3 cursor-pointer text-sm text-ih-fg-3">
                            <input
                              type="checkbox"
                              checked={!!repairItems[item.id]}
                              onChange={() => toggleRepairItem(item.id)}
                              className="rounded border-ih-border-strong"
                            />
                            Add to repair request
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Summary card */}
              {filter === "summary" && (
                <div className="bg-ih-bg-card border border-ih-border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ih-fg-1">
                      {section.items.length} items inspected
                    </span>
                    <span
                      className="text-sm font-semibold"
                      style={{
                        color: section.defectCount > 0 ? "#f43f5e" : "#22c55e",
                      }}
                    >
                      {section.defectCount > 0
                        ? `${section.defectCount} defect${section.defectCount > 1 ? "s" : ""}`
                        : "All clear"}
                    </span>
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              {section.disclaimerText && filter !== "summary" && (
                <div className="mt-4 px-4 py-3 rounded-md border border-ih-border bg-ih-watch-bg/40 text-[12px] leading-relaxed text-ih-fg-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-watch-fg mb-1">
                    Disclaimer
                  </div>
                  <p className="whitespace-pre-line">{section.disclaimerText}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Signature block ──────────────────────────────────────────── */}
      <ReportSignatureBlock isPublished={data.isPublished} signature={data.signature} ownerPreview={data.ownerPreview} />

      {/* ── Verification block ───────────────────────────────────────── */}
      <ReportVerificationBlock verification={data.verification} baseUrl={data.baseUrl} />

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

export default ReportView;
