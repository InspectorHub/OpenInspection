import { Link } from "react-router";
import { formatInspectionDateTime } from "~/lib/format-date";
import { isReportPublished, statusTone } from "~/lib/status";
import { reportStateLabel } from "~/lib/dashboard-filters";
import { REPORT_STATE_TONE, type Inspection } from "~/lib/dashboard-schema";
import { Pill, Icon } from "@core/shared-ui";

interface DashboardInspectionRowProps {
  insp: Inspection;
  reportView?: boolean;
  tenantSlug: string | null;
  selectedIds: Set<string>;
  isColumnVisible: (id: string) => boolean;
  toggleSelect: (id: string) => void;
  transitionStatus: (id: string, status: string) => void;
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
}: DashboardInspectionRowProps) {
  const isSelected = selectedIds.has(insp.id);
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
              {insp.address || insp.propertyAddress || "No address"}
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {isColumnVisible("clientName") && (
              <span className="text-[11px] text-ih-fg-3">
                {insp.clientName || "No client"}
              </span>
            )}
            {isColumnVisible("date") && insp.date && (
              <span className="text-[11px] text-ih-fg-3">
                &middot; {formatInspectionDateTime(insp.date)}
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
          {/* P-4: dashboard rows only carry inspections.price (cache tier 3).
              Invoices and service-snapshot tiers are not loaded here — out of scope.
              Use getEffectivePriceCents() when a full authority-chain read is needed. */}
          {isColumnVisible("price") && insp.price != null && (
            <span className="text-[11px] font-medium text-ih-fg-3">
              ${insp.price}
            </span>
          )}
        </div>
      </Link>
      {/* Hover actions: open editor + status transition (visible on hover) */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-1.5">
        <Link
          to={`/inspections/${insp.id}/edit`}
          aria-label="Open editor"
          title="Open editor"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center h-6 w-6 rounded text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
        >
          <Icon name="edit" size={14} />
        </Link>
        {/* #111: deep-link into the public report (Published tab, delivered/published only) */}
        {showReportLink && (
          <Link
            to={`/report-view/${tenantSlug}/${insp.id}`}
            aria-label="View report"
            title="View report"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center h-6 w-6 rounded text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
          >
            <Icon name="share" size={14} />
          </Link>
        )}
        <select
          value={insp.status}
          onChange={(e) => transitionStatus(insp.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-3 border-0 outline-none cursor-pointer"
        >
          <option value="requested">Requested</option>
          <option value="scheduled">Scheduled</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
    </div>
  );
}
