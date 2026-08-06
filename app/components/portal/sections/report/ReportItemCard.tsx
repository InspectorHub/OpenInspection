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
import { itemDrivesSummary } from "~/lib/report-helpers";
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
}

export function ReportItemCard({
  item,
  showEstimates,
  showPhotos,
  mediaVisible,
  renderMediaTile,
  selectedForRepair,
  onToggleRepairItem,
}: ReportItemCardProps) {
  return (
    <div
      className={`bg-ih-bg-card border border-ih-border overflow-hidden ${PRINT_CARD_CLASS}`}
      style={{ borderRadius: "var(--report-radius)", borderLeftWidth: 4, borderLeftColor: item.ratingColor }}
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
        <ReportDefectCard
          item={item}
          mediaVisible={mediaVisible}
          renderMediaTile={renderMediaTile}
          showPhotos={showPhotos}
        />

        {item.recommendation && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg uppercase">
              {m.report_view_recommend({ value: item.recommendation })}
            </span>
            {showEstimates &&
              (item.estimateMin != null || item.estimateMax != null) && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
                  {m.report_view_estimated_cost_label()} $
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
