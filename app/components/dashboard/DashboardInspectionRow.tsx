import { Link } from "react-router";
import { formatInspectionDateTime } from "~/lib/format-date";
import { INSPECTION_STATUS, isReportPublished, statusTone } from "~/lib/status";
import { reportStateLabel } from "~/lib/dashboard-filters";
import { REPORT_STATE_TONE, type Inspection } from "~/lib/dashboard-schema";
import { Pill, Icon } from "@core/shared-ui";
import { RestoreInspectionAction } from "~/components/RestoreInspectionAction";
import { m } from "~/paraglide/messages";
import { formatDollars } from "~/lib/money";
import { useDisplayLocale, useDisplayCurrency, useTenantFormatPrefs } from "~/hooks/useSessionContext";

interface DashboardInspectionRowProps {
  insp: Inspection;
  reportView?: boolean;
  tenantSlug: string | null;
  selectedIds: Set<string>;
  isColumnVisible: (id: string) => boolean;
  toggleSelect: (id: string) => void;
  transitionStatus: (id: string, status: string) => void;
  /** Viewer's effective zone (useDisplayTimeZone in the owning route). Required:
   *  an omitted zone renders scheduled times in whatever zone the browser is in. */
  timeZone: string;
}

/* ---- Render inspection row ---- */
// reportView=true on the Published tab: render a report-state badge and, for
// delivered/published rows, a "View report" deep-link into the public report.
export function DashboardInspectionRow({
  insp,
  reportView = false,
  tenantSlug,
  selectedIds,
  isColumnVisible,
  toggleSelect,
  transitionStatus,
  timeZone,
}: DashboardInspectionRowProps) {
  const locale = useDisplayLocale();
  const currency = useDisplayCurrency();
  const shape = useTenantFormatPrefs();
  const isSelected = selectedIds.has(insp.id);
  const cancelled = insp.status === INSPECTION_STATUS.CANCELLED;
  const showReportLink =
    reportView && tenantSlug && isReportPublished(insp.reportStatus);
  return (
    <div className="flex items-center gap-2 px-4 py-3 hover:bg-ih-bg-muted transition-colors group">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => toggleSelect(insp.id)}
        className="accent-ih-primary shrink-0"
      />
      <Link
        to={`/inspections/${insp.id}`}
        className="flex items-center justify-between flex-1 min-w-0"
      >
        <div className="min-w-0">
          {isColumnVisible("propertyAddress") && (
            <p className="text-[13px] font-medium text-ih-fg-1 truncate">
              {insp.address || insp.propertyAddress || m.dashboard_row_no_address()}
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {isColumnVisible("clientName") && (
              <span className="text-[11px] text-ih-fg-3">
                {insp.clientName || m.dashboard_row_no_client()}
              </span>
            )}
            {isColumnVisible("date") && insp.date && (
              <span className="text-[11px] text-ih-fg-3">
                &middot; {formatInspectionDateTime(insp.date, undefined, timeZone, { locale, ...shape })}
              </span>
            )}
            {isColumnVisible("agent") && insp.agentName && (
              <span className="text-[11px] text-ih-fg-3">
                &middot; {insp.agentName}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {isColumnVisible("statusIcons") && (
            <Pill tone={statusTone(insp.status)}>
              {insp.status.replace(/_/g, " ")}
            </Pill>
          )}
          {/* report-state badge (Published/to_review tabs) */}
          {reportView && insp.reportStatus && REPORT_STATE_TONE[insp.reportStatus] && (
            <Pill tone={REPORT_STATE_TONE[insp.reportStatus]}>
              {reportStateLabel(insp.reportStatus)}
            </Pill>
          )}
          {isColumnVisible("defectChips") && insp.defectStats && (
            <div className="flex gap-1">
              {insp.defectStats.safety > 0 && (
                <Pill tone="defect">{insp.defectStats.safety}S</Pill>
              )}
              {insp.defectStats.recommendation > 0 && (
                <Pill tone="monitor">{insp.defectStats.recommendation}R</Pill>
              )}
              {insp.defectStats.maintenance > 0 && (
                <Pill tone="info">{insp.defectStats.maintenance}M</Pill>
              )}
            </div>
          )}
          {/* P-4: `price` is the full authority chain — invoice, else the service
              snapshots, else the cached column — resolved server-side in
              getDashboardBuckets (IA-131). It arrives in integer CENTS, like every
              other `_cents` value, so it must be formatted rather than
              interpolated. This rendered `${insp.price}` raw for as long as it did
              because the cache tier reads 0 on real data: "$0" looks the same
              whichever unit you think it is in, and fixing the source is what
              turned it into "$45000". */}
          {isColumnVisible("price") && insp.price != null && (
            <span className="text-[11px] font-medium text-ih-fg-3">
              {formatDollars(insp.price, { locale, currency })}
            </span>
          )}
        </div>
      </Link>
      {/* Hover actions: open editor + status transition (visible on hover) */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-1.5">
        <Link
          to={`/inspections/${insp.id}/edit`}
          aria-label={m.dashboard_row_open_editor()}
          title={m.dashboard_row_open_editor()}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center h-6 w-6 rounded text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
        >
          <Icon name="edit" size={14} />
        </Link>
        {/* #111: deep-link into the public report (Published tab, delivered/published only) */}
        {showReportLink && (
          <Link
            to={`/report-view/${tenantSlug}/${insp.id}`}
            aria-label={m.dashboard_row_view_report()}
            title={m.dashboard_row_view_report()}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center h-6 w-6 rounded text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
          >
            <Icon name="share" size={14} />
          </Link>
        )}
        {/* #78 — NO "Cancelled" TO PICK. This dropdown PATCHes the status
            straight onto the inspection, which skips the fee ladder, the
            refund and the recorded reason that only `POST /:id/cancel`
            performs — so a cancellation taken from here left the money saying
            the job was still on. Cancelling lives on the inspection's own
            Lifecycle card, behind the priced confirmation. The API refuses this
            write regardless; the option is gone so the UI stops offering a door
            the server has closed.

            #81 — AND A CANCELLED ROW GETS NO DROPDOWN AT ALL, for the mirror
            reason. Leaving `cancelled` used to be a plain status write here,
            which was the product's ONLY recovery and did less than the endpoint
            built for the job: `POST /:id/uncancel` also restores the calendar
            entry. That endpoint is the one door now and this write refuses, so
            the cancelled cluster below shows the status and offers the button
            instead of four options the server would reject. */}
        {!cancelled && (
          <select
            value={insp.status}
            onChange={(e) => transitionStatus(insp.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-2 border-0 outline-none cursor-pointer"
          >
            <option value="requested">{m.dashboard_row_status_requested()}</option>
            <option value="scheduled">{m.dashboard_row_status_scheduled()}</option>
            <option value="confirmed">{m.dashboard_row_status_confirmed()}</option>
            <option value="completed">{m.dashboard_row_status_completed()}</option>
          </select>
        )}
      </div>
      {/* OUTSIDE the hover group, and that is load-bearing twice over. The
          restore control carries a confirmation Modal, which renders INLINE
          rather than through a portal — an ancestor at `opacity-0` would both
          hide it and become the containing block its `fixed inset-0` backdrop
          resolves against, so the dialog would vanish the moment the pointer
          left the row. It is also the point of #81 that recovery is findable:
          a hover-only affordance is what made the old one undiscoverable. */}
      {cancelled && (
        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <select
            value={insp.status}
            disabled
            aria-label={m.dashboard_row_status_cancelled()}
            className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-2 border-0 outline-none disabled:opacity-100"
          >
            <option value="cancelled">{m.dashboard_row_status_cancelled()}</option>
          </select>
          <RestoreInspectionAction
            inspectionId={insp.id}
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
          />
        </div>
      )}
    </div>
  );
}
