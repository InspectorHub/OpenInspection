/**
 * <ReportRepairPanel> — the bottom-sheet repair-request panel listing the items
 * the client checked "Add to repair request" on.
 *
 * Extracted from <ReportView>'s former inline JSX. Behavior-preserving: the
 * markup is byte-identical; the selected-item list, the estimate flag and the
 * close handler are threaded in as props so the panel stays presentational.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { ReportItem } from "./types";

export interface ReportRepairPanelProps {
  selectedRepairList: ReportItem[];
  showEstimates: boolean;
  onClose: () => void;
}

export function ReportRepairPanel({ selectedRepairList, showEstimates, onClose }: ReportRepairPanelProps) {
  return (
    <div className="print:hidden fixed bottom-0 left-0 right-0 z-50 bg-ih-bg-card border-t border-ih-border max-h-[60vh] overflow-y-auto rounded-t-xl">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-ih-fg-1">
            {m.pca_repair_panel_title()}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2"
          >
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>
        {selectedRepairList.length === 0 ? (
          <div className="text-center py-8 text-ih-fg-4">
            {m.pca_repair_panel_empty()}
          </div>
        ) : (
          <>
            {selectedRepairList.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 border-b border-ih-border"
              >
                <div>
                  <span className="font-medium text-sm text-ih-fg-1">
                    {item.label}
                  </span>
                  {item.recommendation && (
                    <span className="text-xs text-ih-fg-4 ml-2">
                      -- {item.recommendation}
                    </span>
                  )}
                </div>
                {showEstimates &&
                  (item.estimateMin || item.estimateMax) && (
                    <span className="text-xs font-mono text-ih-fg-4">
                      ${item.estimateMin || "?"} - ${item.estimateMax || "?"}
                    </span>
                  )}
              </div>
            ))}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-ih-fg-1">
                {m.pca_repair_panel_item_count({ count: selectedRepairList.length })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3"
                >
                  {m.pca_repair_panel_export_pdf()}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-ih-primary-fg"
                >
                  {m.pca_repair_panel_send()}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
