/**
 * <ReportItemCard> — one inspection item as the client reads it: label, rating
 * pill, the non-rich value, notes, defects, the recommendation + estimate, the
 * attached repair items, the photo grid, and the "add to repair request"
 * checkbox.
 *
 * Extracted verbatim from <ReportView>'s section loop. It stays presentational:
 * the media predicate (`mediaVisible`) and the tile renderer (`renderMediaTile`)
 * are threaded in, because both close over the report-wide failed-photo Set and
 * the lightbox, which belong to the report and not to any one item.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import type { ReactNode } from "react";
import { m } from "~/paraglide/messages";
import { itemDrivesSummary, itemIsUnrated } from "~/lib/report-helpers";
import { ReportDefectCard } from "./ReportDefectCard";
import { ITEM_PHOTO_GRID_CLASS, PRINT_CARD_CLASS, type ReportItem, type ReportPhoto } from "./types";

export interface ReportItemCardProps {
  item: ReportItem;
  showEstimates: boolean;
  /** Commercial PCA Phase P — false in 'appendix' photoMode: the body stays
   *  text-only and every photo moves to the end-of-report Appendix B. */
  showPhotos: boolean;
  mediaVisible: (p: ReportPhoto) => boolean;
  renderMediaTile: (photo: ReportPhoto, alt: string, idx: number) => ReactNode;
  selectedForRepair: boolean;
  onToggleRepairItem: (itemId: string) => void;
  /**
   * This item sits under another one.
   *
   * A card of its own would tell the reader this row is as important as the
   * ones around it, and a qualifier -- "check here if the entire deck underside
   * is covered" -- is not. So a nested card drops its own frame and its heading
   * drops a level: it reads as part of the row above rather than as a peer of it.
   */
  nested?: boolean;
}

export function ReportItemCard({
  item,
  showEstimates,
  showPhotos,
  mediaVisible,
  renderMediaTile,
  selectedForRepair,
  onToggleRepairItem,
  nested = false,
}: ReportItemCardProps) {
  return (
    <div
      data-testid="report-item-card"
      data-nested={nested ? "true" : undefined}
      className={`bg-ih-bg-card overflow-hidden ${nested ? "border-l border-ih-border" : "border border-ih-border"} ${PRINT_CARD_CLASS}`}
      style={nested
        ? { borderInlineStartWidth: 2, borderInlineStartColor: item.ratingColor }
        : { borderRadius: "var(--report-radius)", borderLeftWidth: 4, borderLeftColor: item.ratingColor }}
    >
      <div className={nested ? "px-4 py-3" : "p-4"}>
        <div className="flex items-start justify-between mb-2">
          <h4 className={nested ? "font-medium text-[14px] text-ih-fg-1" : "font-semibold text-ih-fg-1"}>
            {item.label}
          </h4>
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

        {/* WHICH KIND OF "no rating", and why.
            The Texas REI 7-6 form gives NP and NI their own checkboxes and
            defines them apart — NP means the component is not in the dwelling,
            NI means it is there and was not inspected — and ASTM E2018 asks a
            commercial walk-through to record what was not seen and why. The
            pill above cannot carry this on its own: it shows the tenant's
            LABEL, and `getNaKind` falls back to the label only after trying the
            ABBREVIATION, precisely because a workspace may label a level "N/A"
            while abbreviating it "NI". `naKind` is the value that always knows.
            The reason is the half that matters to a buyer: a limitation nobody
            states is a limitation nobody can act on. */}
        {/* NO ANSWER IS ALSO AN ANSWER, and it has to be printed as one.
            See `itemIsUnrated` for why this is not the `Not Inspected` rating
            and why non-rich items are excluded. Rendered above the naKind line
            because the two are mutually exclusive: naKind only exists on an item
            that HAS a rating. */}
        {itemIsUnrated(item) && (
          <p className="mb-2 text-[12px] text-ih-fg-3">
            <span className="font-semibold text-ih-fg-2">{m.report_item_unrated()}</span>
            {` — ${m.report_item_unrated_body()}`}
          </p>
        )}

        {item.naKind && (
          <p className="mb-2 text-[12px] text-ih-fg-3">
            <span className="font-semibold text-ih-fg-2">
              {item.naKind === "not_present"
                ? m.report_item_not_present()
                : m.report_item_not_inspected()}
            </span>
            {item.notInspectedReason ? ` — ${item.notInspectedReason}` : ""}
          </p>
        )}

        {/* Non-rich item value */}
        {item.type &&
          item.type !== "rich" &&
          item.value !== undefined &&
          item.value !== null &&
          item.value !== "" && (
            <p className="mt-2 text-sm font-semibold text-ih-fg-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mr-2">
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
        <ReportDefectCard
          item={item}
          mediaVisible={mediaVisible}
          renderMediaTile={renderMediaTile}
          showPhotos={showPhotos}
        />

        {/* The recommendation is WHAT to do. The "Estimated cost" badge that
            used to sit beside it is gone: the server no longer emits an
            item-level estimate at all, so there is nothing left for
            `showEstimates` to gate here. */}
        {item.recommendation && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg uppercase">
              {m.report_view_recommend({ value: item.recommendation })}
            </span>
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
                {showEstimates && (ri.estimateMin != null || ri.estimateMax != null) && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
                    ${ri.estimateMin?.toLocaleString() ?? "?"} – ${ri.estimateMax?.toLocaleString() ?? "?"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {showPhotos && item.photos.filter(mediaVisible).length > 0 && (
          <div className={`mt-3 ${ITEM_PHOTO_GRID_CLASS}`}>
            {item.photos
              .filter(mediaVisible)
              .map((photo, idx) => renderMediaTile(photo, `${item.label} — photo ${idx + 1}`, idx))}
          </div>
        )}

        {itemDrivesSummary(item) && (
          <label className="print:hidden flex items-center gap-2 mt-3 cursor-pointer text-sm text-ih-fg-3">
            <input
              type="checkbox"
              checked={selectedForRepair}
              onChange={() => onToggleRepairItem(item.id)}
              className="rounded border-ih-border-strong"
            />
            {m.report_view_add_to_repair()}
          </label>
        )}
      </div>
    </div>
  );
}
