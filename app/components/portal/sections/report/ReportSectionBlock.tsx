/**
 * <ReportSectionBlock> — one section of the report body: its numbered heading,
 * the item cards under it, the collapsed summary card that replaces them in
 * "summary" filter mode, and the section disclaimer.
 *
 * These four belong together because the active `filter` decides among them:
 * "defects" drops empty sections entirely, "summary" swaps the item list for a
 * single count card AND suppresses the disclaimer. Reading any one of them
 * without the others tells you the wrong thing about what the client sees.
 *
 * Extracted verbatim from <ReportView>'s `filteredSections.map`. Presentational
 * — the report owns the filter, the failed-photo Set and the repair selection.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import type { ReactNode } from "react";
import { m } from "~/paraglide/messages";
import { EnglishSpanBadge } from "./TranslationNotice";
import { useAnchorId } from "./report-half-scope";
import { getSectionIcon } from "~/lib/report-helpers";
import { ReportItemCard } from "./ReportItemCard";
import { itemDepths, subtreeOf } from "../../../../../server/lib/template-hierarchy";
import {
  PRINT_SECTION_HEADING_CLASS,
  REPORT_HEADING_STYLE,
  type FilterKey,
  type ReportPhoto,
  type ReportSection,
} from "./types";

export interface ReportSectionBlockProps {
  section: ReportSection;
  /** Zero-based position in the FILTERED list — the heading numbers off this. */
  sectionIdx: number;
  filter: FilterKey;
  showEstimates: boolean;
  showPhotos: boolean;
  mediaVisible: (p: ReportPhoto) => boolean;
  renderMediaTile: (photo: ReportPhoto, alt: string, idx: number) => ReactNode;
  repairItems: Record<string, boolean>;
  onToggleRepairItem: (itemId: string) => void;
  /**
   * True while the reader is looking at the courtesy-translation half.
   *
   * A translated deliverable is mixed-language by construction — the
   * per-section disclaimer is part of the inspection record and is never
   * machine-translated — so the English spans inside it are MARKED rather than
   * left to look like an untranslated remnant. A reader who thinks the
   * translation is broken discounts the notice too.
   */
  showingTranslation?: boolean;
}

export function ReportSectionBlock({
  section,
  sectionIdx,
  filter,
  showEstimates,
  showPhotos,
  mediaVisible,
  renderMediaTile,
  repairItems,
  onToggleRepairItem,
  showingTranslation = false,
}: ReportSectionBlockProps) {
  // A TOC target — so it is namespaced per half. See report-half-scope.
  const anchorId = useAnchorId();
  // Sub-items render INSIDE their parent's card rather than as peer cards. A
  // card of its own tells the reader this row is as important as the ones
  // around it, and a qualifier is not.
  const depths = itemDepths(section.items);
  const present = new Set(section.items.map((i) => i.id));
  // A parentId pointing outside THIS list is a top-level card, not a dropped
  // row: the `defects` filter removes items, so a child can outlive its parent.
  const topLevel = section.items.filter((i) => {
    const parentId = i.parentId ?? null;
    return parentId === null || !present.has(parentId);
  });
  // The WHOLE subtree, not the direct children. Taking only direct children
  // would print nothing for a third level -- and printing less is this design's
  // one failure mode that throws nothing and shows up only on paper.
  const descendantsOf = (id: string) => {
    const ids = new Set(subtreeOf(section.items, id).slice(1));
    return section.items.filter((i) => ids.has(i.id));
  };
  if (filter === "defects" && section.items.length === 0) return null;
  return (
    <div id={anchorId(section.id)} className="mb-6 group/section relative scroll-mt-4" style={section.alwaysPageBreak ? { breakBefore: "page" } : undefined}>
      <div className={`flex items-center gap-3 mb-4 ${PRINT_SECTION_HEADING_CLASS}`}>
        <span className="text-2xl">{getSectionIcon(section.title)}</span>
        <h2 className="text-2xl text-ih-fg-1" style={REPORT_HEADING_STYLE}>
          <span className="mr-1 text-ih-fg-4">
            {sectionIdx + 1} -
          </span>
          {section.title}
        </h2>
        <div className="flex-1 h-px" style={{ borderTop: "1px solid var(--report-band)" }} />
        <span className="text-xs font-mono text-ih-fg-3">
          {m.report_view_section_items({ count: section.items.length })}
        </span>
      </div>

      {/* Items (hidden in summary mode) */}
      {filter !== "summary" && (
        <div className="space-y-3">
          {topLevel.map((item) => (
            <div key={item.id} data-report-item>
              <ReportItemCard
                item={item}
                showEstimates={showEstimates}
                showPhotos={showPhotos}
                mediaVisible={mediaVisible}
                renderMediaTile={renderMediaTile}
                selectedForRepair={!!repairItems[item.id]}
                onToggleRepairItem={onToggleRepairItem}
              />
              {descendantsOf(item.id).map((child) => (
                <div
                  key={child.id}
                  data-report-subitem
                  /* Logical inline start, so a right-to-left report indents from
                     the right with no second code path. Inline rather than a
                     utility: the wrapper's own classes already set spacing, and
                     two utilities of equal specificity resolve by stylesheet
                     order rather than by the order written here. */
                  style={{ marginInlineStart: (depths.get(child.id) ?? 1) * 16 }}
                  className="mt-2"
                >
                  <ReportItemCard
                    item={child}
                    nested
                    showEstimates={showEstimates}
                    showPhotos={showPhotos}
                    mediaVisible={mediaVisible}
                    renderMediaTile={renderMediaTile}
                    selectedForRepair={!!repairItems[child.id]}
                    onToggleRepairItem={onToggleRepairItem}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Summary card */}
      {filter === "summary" && (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium text-ih-fg-1">
              {m.report_view_items_inspected({ count: section.items.length })}
            </span>
            <span
              className="text-sm font-semibold"
              style={{
                color: section.defectCount > 0 ? "#f43f5e" : "#22c55e",
              }}
            >
              {section.defectCount > 0
                ? m.report_view_defect_count({ count: section.defectCount, plural: section.defectCount > 1 ? "s" : "" })
                : m.report_view_all_clear()}
            </span>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      {section.disclaimerText && filter !== "summary" && (
        <div className="mt-4 px-4 py-3 rounded-md border border-ih-border bg-ih-watch-bg/40 text-[12px] leading-relaxed text-ih-fg-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-watch-fg mb-1">
            {m.report_view_disclaimer()}
            <EnglishSpanBadge showing={showingTranslation} />
          </div>
          <p className="whitespace-pre-line">{section.disclaimerText}</p>
        </div>
      )}
    </div>
  );
}
