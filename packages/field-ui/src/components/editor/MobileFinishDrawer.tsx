import { Button } from "@core/shared-ui";
import { MobileBottomDrawer } from "../MobileBottomDrawer";
import { m } from "../../i18n";

export interface MobileFinishDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Runs the publish readiness pre-flight, then opens the publish modal. */
  onPublish: () => void;
  /** Opens the manual signature modal. */
  onSign: () => void;
  /** Opens the per-inspection report settings sheet; null when the host has none (the button is left out). */
  onOpenSettings: (() => void) | null;
  /** Advisory lifecycle move; null once the fieldwork is already complete. */
  onFinishFieldwork: (() => void) | null;
  /** Whether the finish-fieldwork request is in flight. */
  finishingFieldwork: boolean;
  /** Opens the full web report in a new tab; null when the slug is unknown. */
  onPreviewReport: (() => void) | null;
  /** Opens Speed mode; null when nothing is left to rate. It leads the Capture group and needs no camera or open item. */
  onSpeedMode?: (() => void) | null;
  /** Opens the burst camera; null when the device has no camera API or no item is open (its row is then left out). */
  onBurstCamera?: (() => void) | null;
  /** Opens version history; null unless collaboration and the host's version history are both there. */
  onOpenVersionHistory?: (() => void) | null;
  /** Opens the units manager; null unless the inspection is commercial. */
  onOpenUnits?: (() => void) | null;
  /** Opens the cost items drawer; null unless the inspection is commercial and the host has cost lines. */
  onOpenCostItems?: (() => void) | null;
  /** Renders the report as a PDF; null when the host has no PDF export (the row is left out). */
  onPreviewPdf?: (() => void) | null;
  /** The PDF row's label as the host words it (it counts down a cooldown, for one). */
  pdfLabel?: string;
  /** The PDF export is running or cooling down: the row stays but does not act. */
  pdfBusy?: boolean;
  /** The host's last PDF error, shown under the row. */
  pdfError?: string | null;
  /** Template actions, as in the desktop Template menu. Change needs the settings sheet; Update source needs a source template. */
  onChangeTemplate?: (() => void) | null;
  onSaveAsNewTemplate?: (() => void) | null;
  onUpdateSourceTemplate?: (() => void) | null;
  /** Opens the Theme drawer; null when the host supplies no theme control (the row is left out). */
  onOpenTheme?: (() => void) | null;
}

/**
 * The ending the mobile walkthrough was missing.
 *
 * Below 768px the editor renders its own tree — app bar, section/item drawers,
 * item editor — built for walking a property on the device you carry. It had no
 * Publish, no Sign, no Preview and no report settings, and the app bar's own
 * "More actions" button was a comment reading `future: open more menu`. An
 * inspector could complete an entire inspection on a phone and then have no way
 * to finish it.
 *
 * Publish leads because it is what someone opens this for, then Sign and Finish fieldwork. Below them come the
 * things a phone has no key or dock for: a "Capture" group (speed mode, burst camera) and an "Inspection" group (version
 * history, units, cost items, report settings), each behind the same gate as its desktop control. The
 * template menu and search stay back-office. This opens from the app bar rather than gaining a fifth tab in the
 * bottom nav: a terminal action does not belong in a row of navigation.
 */
export function MobileFinishDrawer({
  open,
  onClose,
  onPublish,
  onSign,
  onOpenSettings,
  onFinishFieldwork,
  finishingFieldwork,
  onPreviewReport,
  onSpeedMode = null,
  onBurstCamera = null,
  onOpenVersionHistory = null,
  onOpenUnits = null,
  onOpenCostItems = null,
  onPreviewPdf = null,
  pdfLabel,
  pdfBusy = false,
  pdfError = null,
  onChangeTemplate = null,
  onSaveAsNewTemplate = null,
  onUpdateSourceTemplate = null,
  onOpenTheme = null,
}: MobileFinishDrawerProps) {
  const run = (fn: () => void) => {
    onClose();
    fn();
  };
  // A hit area of at least 44px and no tap delay on every row; the groups below the ending actions are headed in
  // sentence case, and a group with no rows has no heading.
  const row = "w-full min-h-11 touch-manipulation";
  const inspectionRows: Array<{ label: string; run: () => void }> = [];
  if (onOpenVersionHistory) inspectionRows.push({ label: m.editor_header_version_history(), run: onOpenVersionHistory });
  if (onOpenUnits) inspectionRows.push({ label: m.editor_route_units(), run: onOpenUnits });
  if (onOpenCostItems) inspectionRows.push({ label: m.editor_route_cost_items(), run: onOpenCostItems });
  if (onOpenSettings) inspectionRows.push({ label: m.editor_header_settings(), run: onOpenSettings });
  const templateRows: Array<{ label: string; run: () => void }> = [];
  if (onChangeTemplate) templateRows.push({ label: m.template_menu_change(), run: onChangeTemplate });
  if (onSaveAsNewTemplate) templateRows.push({ label: m.template_menu_save_new(), run: onSaveAsNewTemplate });
  if (onUpdateSourceTemplate) templateRows.push({ label: m.template_menu_update_source(), run: onUpdateSourceTemplate });
  const groupHeading = "px-1 pt-3 pb-1 text-[12px] font-bold text-ih-fg-2";
  return (
    <MobileBottomDrawer open={open} onClose={onClose} title={m.editor_mobile_more()} heightFraction={0.8}>
      <div className="p-4 space-y-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <Button variant="primary" className={row} onClick={() => run(onPublish)}>
          {m.editor_header_publish()}
        </Button>
        <Button variant="secondary" className={row} onClick={() => run(onSign)}>
          {m.editor_header_sign()}
        </Button>
        {onFinishFieldwork && (
          <Button
            variant="secondary"
            className={row}
            pending={finishingFieldwork}
            onClick={() => run(onFinishFieldwork)}
          >
            {finishingFieldwork ? m.editor_finish_fieldwork_pending() : m.editor_finish_fieldwork()}
          </Button>
        )}
        {onPreviewReport && (
          <Button variant="secondary" className={row} onClick={() => run(onPreviewReport)}>
            {m.editor_header_preview_report()}
          </Button>
        )}
        {onPreviewPdf && (
          <>
            <Button variant="secondary" className={row} pending={pdfBusy} onClick={() => run(onPreviewPdf)}>
              {pdfLabel ?? m.editor_header_preview_pdf_short()}
            </Button>
            {pdfError && <p className="px-1 text-[12px] text-ih-bad-fg">{pdfError}</p>}
          </>
        )}
        {(onSpeedMode || onBurstCamera) && (
          <>
            <h3 className={groupHeading}>{m.editor_mobile_group_capture()}</h3>
            {onSpeedMode && (
              <Button variant="secondary" className={row} onClick={() => run(onSpeedMode)}>
                {m.editor_dock_speed_mode()}
              </Button>
            )}
            {onBurstCamera && (
              <Button variant="secondary" className={row} onClick={() => run(onBurstCamera)}>
                {m.editor_mobile_burst_camera()}
              </Button>
            )}
          </>
        )}
        {inspectionRows.length > 0 && (
          <>
            <h3 className={groupHeading}>{m.editor_mobile_group_inspection()}</h3>
            {inspectionRows.map((r) => (
              <Button key={r.label} variant="secondary" className={row} onClick={() => run(r.run)}>
                {r.label}
              </Button>
            ))}
          </>
        )}
        {templateRows.length > 0 && (
          <>
            <h3 className={groupHeading}>{m.template_menu_template()}</h3>
            {templateRows.map((r) => (
              <Button key={r.label} variant="secondary" className={row} onClick={() => run(r.run)}>
                {r.label}
              </Button>
            ))}
          </>
        )}
        {onOpenTheme && (
          <Button variant="secondary" className={`${row} mt-3`} onClick={() => run(onOpenTheme)}>
            {m.nav_theme_label()}
          </Button>
        )}
      </div>
    </MobileBottomDrawer>
  );
}
