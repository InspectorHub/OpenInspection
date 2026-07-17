/**
 * <ReportDefectCard> — the included canned + custom defects block rendered under
 * an inspection item (FE-3/B-20).
 *
 * Extracted from <ReportView>'s former inline JSX. Behavior-preserving: the
 * markup is byte-identical; the media predicate (`mediaVisible`) and the media
 * tile renderer (`renderMediaTile`) are threaded in as props so the card stays
 * presentational.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import type { ReactNode } from "react";
import { m } from "~/paraglide/messages";
import { DefectCategoryChip } from "~/components/editor-shared/DefectCategoryChip";
import { DEFECT_PHOTO_GRID_CLASS, PRINT_CARD_CLASS, type ReportItem, type ReportPhoto } from "./types";

export interface ReportDefectCardProps {
  item: ReportItem;
  mediaVisible: (p: ReportPhoto) => boolean;
  renderMediaTile: (photo: ReportPhoto, alt: string, idx: number) => ReactNode;
  /** Commercial PCA Phase P — false in 'appendix' photoMode so the body stays
   *  text-only (photos move to the end-of-report Appendix B). Defaults to
   *  true so existing callers (and the byte-identical 'inline' default path)
   *  are unaffected. */
  showPhotos?: boolean;
}

export function ReportDefectCard({ item, mediaVisible, renderMediaTile, showPhotos = true }: ReportDefectCardProps) {
  if ((item.resolvedTabs?.defects ?? []).filter((d) => d.included).length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {(item.resolvedTabs?.defects ?? [])
        .filter((d) => d.included)
        .map((d) => (
          <div
            key={d.id}
            className={`rounded-md border border-ih-border bg-ih-bg-app/60 px-3 py-2 ${PRINT_CARD_CLASS}`}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-bold text-ih-fg-1">{d.title}</span>
              {d.effectiveCategory && (
                <DefectCategoryChip category={d.effectiveCategory} color={d.categoryColor} />
              )}
              {d.isCustom && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-primary-tint text-ih-primary">
                  {m.pca_defect_card_inspector_added()}
                </span>
              )}
              {d.effectiveLocation && (
                <span className="text-[11px] text-ih-fg-4">@ {d.effectiveLocation}</span>
              )}
            </div>
            {d.effectiveComment && (
              <p className="text-[13px] text-ih-fg-3 mt-1 leading-relaxed">
                {d.effectiveComment}
              </p>
            )}
            {showPhotos && (d.defectPhotos ?? []).filter(mediaVisible).length > 0 && (
              <div className={`mt-2 ${DEFECT_PHOTO_GRID_CLASS}`}>
                {(d.defectPhotos ?? [])
                  .filter(mediaVisible)
                  .map((photo, idx) => renderMediaTile(photo, `${d.title} — photo ${idx + 1}`, idx))}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
