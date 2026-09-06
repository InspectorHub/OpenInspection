/**
 * <ReportRepairPanel> — the bottom-sheet repair-request panel listing the items
 * the client checked "Add to repair request" on.
 *
 * Extracted from <ReportView>'s former inline JSX; the selected-item list and
 * the close handler are threaded in as props so the panel stays presentational.
 *
 * There is no `showEstimates` prop any more: the panel used it to print a price
 * per row, and the server emits no item-level estimate to print.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { ReportItem } from "./types";

export interface ReportRepairPanelProps {
  selectedRepairList: ReportItem[];
  onClose: () => void;
  /**
   * Where the repair request is actually built and sent.
   *
   * The Send button below had no `onClick` for its whole life, and the reason
   * it is a LINK rather than a new endpoint is that the flow already exists:
   * `/repair-builder/{tenant}/{id}` is a real route with create, add-item,
   * intro, share, PDF and email behind it, and `ReportHeader` already links
   * there. This panel is presentational — it holds a client-side selection and
   * no inspection identity — so the honest fix is to take the reader to the
   * flow, not to grow a second one here.
   *
   * NULL when the tenant has `enableCustomerRepairExport` off. The panel's own
   * toggle is gated only on `hideClientActions`, while the header's builder
   * link is gated on BOTH — so a tenant who switched the builder off can still
   * open this panel, and a Send that ignored the flag would hand back the
   * capability they turned off.
   */
  builderHref: string | null;
}

export function ReportRepairPanel({ selectedRepairList, onClose, builderHref }: ReportRepairPanelProps) {
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
                    <span className="text-xs text-ih-fg-3 ml-2">
                      -- {item.recommendation}
                    </span>
                  )}
                </div>
                {/* No price column: the server emits no item-level estimate. */}
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
                {/* An <a>, not a button with a handler: this navigates, and a
                    button that navigates is a button a middle-click and a
                    "open in new tab" cannot use. */}
                {builderHref && (
                  <a
                    href={builderHref}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-ih-primary-fg inline-flex items-center"
                  >
                    {m.pca_repair_panel_send()}
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
