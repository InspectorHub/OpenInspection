import { IconButton, SegmentedControl } from "@core/shared-ui";
import type { ItemFilter, useInspectionState } from "../../hooks/useInspection";
import type { useStatutoryFormProgress } from "../../hooks/useStatutoryGroups";
import { useReadOnly } from "../../read-only";
import { m } from "../../i18n";

type EditorState = ReturnType<typeof useInspectionState>;

/**
 * Filter chips, the statutory progress and the batch toggle above the item list. Fixed-width on desktop: es-419
 * "Sin calificar" broke mid-phrase inside its chip, so the STRIP wraps and labels do not. Tablet reuses it as is.
 * The batch toggle starts a write (a rating applied to many items), so a read-only editor does not offer it.
 */
export function ItemFilterBar({ state, formProgress, isMobile }: { state: EditorState; formProgress: ReturnType<typeof useStatutoryFormProgress>; isMobile: boolean }) {
  const readOnly = useReadOnly();
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-ih-border">
      <SegmentedControl
        ariaLabel={m.editor_route_item_filter()}
        value={state.itemFilter}
        onChange={(v) => state.setItemFilter(v as ItemFilter)}
        options={(["all", "unrated", "issues", "flagged"] as const).map((f) => ({
          value: f,
          label: (
            <span className="whitespace-nowrap">
              {f === "all" ? m.editor_route_filter_all() : f === "unrated" ? m.editor_route_filter_unrated() : f === "issues" ? m.editor_route_filter_issues() : m.editor_route_filter_flagged()}
              {f !== "all" && (
                <span className="ml-1 text-[10px]">
                  {f === "unrated" ? state.filterCounts.unrated : f === "issues" ? state.filterCounts.issues : state.filterCounts.flagged}
                </span>
              )}
            </span>
          ),
        }))}
      />
      {formProgress && (
        <span className="ml-auto text-[11px] text-ih-fg-3 whitespace-nowrap">
          {m.statutory_form_completeness({ answered: String(formProgress.answered), total: String(formProgress.total) })}
        </span>
      )}
      {/* Batch mode toggle — object-scoped action, lives with the items it selects (moved out of the global header). */}
      {!readOnly && (
        <IconButton
          onClick={() => {
            if (state.batchMode) {
              state.setBatchMode(false);
              state.setBatchSelected({});
            } else {
              state.setBatchMode(true);
            }
          }}
          selected={state.batchMode}
          size="sm"
          className={isMobile ? "ml-auto w-11 h-11 touch-manipulation" : "ml-auto"}
          title={state.batchMode ? m.editor_route_exit_batch_mode() : m.editor_route_batch_mode()}
          aria-label={state.batchMode ? m.editor_route_exit_batch_mode() : m.editor_route_batch_select_items()}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </IconButton>
      )}
    </div>
  );
}
