import { IconButton, SegmentedControl } from "@core/shared-ui";
import type { ItemFilter, useInspectionState } from "../../hooks/useInspection";
import type { useStatutoryFormProgress } from "../../hooks/useStatutoryGroups";
import { useReadOnly } from "../../read-only";
import { m } from "../../i18n";

type EditorState = ReturnType<typeof useInspectionState>;

/**
 * Filter chips, the statutory progress and the batch toggle above the item list. The chips take their own row and share
 * it; in a narrow pane (a 255px tablet list, es-419 labels) the LABEL is cut with an ellipsis and the COUNT stays whole,
 * and each chip's title carries the full "label count". Tablet reuses it as is.
 * The batch toggle starts a write (a rating applied to many items), so a read-only editor does not offer it.
 */
export function ItemFilterBar({ state, formProgress, isMobile }: { state: EditorState; formProgress: ReturnType<typeof useStatutoryFormProgress>; isMobile: boolean }) {
  const readOnly = useReadOnly();
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-ih-border">
      <SegmentedControl
        ariaLabel={m.editor_route_item_filter()}
        className="w-full min-w-0 [&>button]:min-w-0 [&>button]:pointer-coarse:min-w-11 [&>button]:px-1.5 [&>button>span:last-child]:min-w-0"
        value={state.itemFilter}
        onChange={(v) => state.setItemFilter(v as ItemFilter)}
        options={(["all", "unrated", "issues", "flagged"] as const).map((f) => {
          const text = f === "all" ? m.editor_route_filter_all() : f === "unrated" ? m.editor_route_filter_unrated() : f === "issues" ? m.editor_route_filter_issues() : m.editor_route_filter_flagged();
          const count = f === "all" ? null : state.filterCounts[f];
          return {
            value: f,
            title: count === null ? m.editor_route_filter_all_in_section() : m.editor_route_filter_count_in_section({ label: text, count }),
            label: (
              <span className="flex min-w-0 items-baseline gap-1">
                <span className="min-w-0 truncate">{text}</span>
                {count !== null && <span className="shrink-0 tabular-nums text-[10px]">{count}</span>}
              </span>
            ),
          };
        })}
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
