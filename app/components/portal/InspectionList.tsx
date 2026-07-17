import { EmptyState, Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface InspectionRow {
  inspectionId: string;
  address: string;
  date: string;
  inspectionStatus: string;
  reportPublished: boolean;
  paymentStatus: string;
}

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function paymentTone(status: string): "sat" | "warning" {
  return status.toLowerCase() === "paid" ? "sat" : "warning";
}

/**
 * Data-source-agnostic inspection list (props only). The client portal and the
 * agent portal both feed it rows + an href builder.
 */
export default function InspectionList({
  rows,
  hrefFor,
}: {
  rows: InspectionRow[];
  hrefFor: (inspectionId: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={m.portal_list_empty_title()}
        description={m.portal_list_empty_description()}
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <a
          key={r.inspectionId}
          href={hrefFor(r.inspectionId)}
          className="block bg-ih-bg-card border border-ih-border rounded-lg p-4 hover:bg-ih-bg-muted transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ih-fg-1 truncate">
                {r.address || m.portal_address_fallback()}
              </div>
              {r.date && <div className="mt-0.5 text-xs text-ih-fg-3">{r.date}</div>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Pill tone="neutral">{capitalize(r.inspectionStatus)}</Pill>
            <Pill tone={r.reportPublished ? "sat" : "np"}>
              {r.reportPublished ? m.portal_list_report_published() : m.portal_list_report_pending()}
            </Pill>
            <Pill tone={paymentTone(r.paymentStatus)}>{capitalize(r.paymentStatus)}</Pill>
          </div>
        </a>
      ))}
    </div>
  );
}
