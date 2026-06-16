import InspectionStatusCards, { type StatusOverview } from "./InspectionStatusCards";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

export type HubSection =
  | "overview"
  | "report"
  | "agreement"
  | "payment"
  | "progress"
  | "messages"
  | "repair";

export interface HubLinkCtx {
  tenant: string;
  inspectionId: string;
  token: string;
}

/* ------------------------------------------------------------------ */
/* Pure model (unit-tested) */
/* ------------------------------------------------------------------ */

/**
 * Interim deep-links (phase ①) — these point at existing standalone pages.
 * Phases ②–⑥ will replace these with inline sections rendered inside the hub.
 *
 * Built with template strings (not URL) because the base is relative.
 */
export function hubSectionHref(section: HubSection, ctx: HubLinkCtx): string {
  const { tenant, inspectionId, token } = ctx;
  const t = encodeURIComponent(token);
  const reportHref = `/report/${tenant}/${inspectionId}?token=${t}`;
  switch (section) {
    case "overview":
      return `/portal/${tenant}/i/${inspectionId}`;
    case "report":
      return reportHref;
    case "agreement":
      // The report page hosts the agreement gate; no signer token in hub ctx.
      return reportHref;
    case "payment":
      return `/r/${inspectionId}/invoice`;
    case "progress":
      return `/observe/inspections/${inspectionId}?token=${t}`;
    case "messages":
      // No messageToken in hub ctx → fall back to the report page.
      return reportHref;
    case "repair":
      return `/repair-builder/${tenant}/${inspectionId}?token=${t}`;
  }
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

const NAV: Array<{ section: HubSection; label: string }> = [
  { section: "overview", label: "Overview" },
  { section: "report", label: "Report" },
  { section: "agreement", label: "Agreement" },
  { section: "payment", label: "Payment" },
  { section: "progress", label: "Progress" },
  { section: "messages", label: "Messages" },
  { section: "repair", label: "Repair Request" },
];

export default function InspectionHub({
  overview,
  ctx,
  activeSection = "overview",
}: {
  overview: StatusOverview;
  ctx: HubLinkCtx;
  activeSection?: HubSection;
}) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight text-ih-fg-1">
          {overview.address || "Inspection"}
        </h1>
        {overview.date && <p className="mt-1 text-sm text-ih-fg-3">{overview.date}</p>}
      </div>

      {/* Top nav */}
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-ih-border pb-3">
        {NAV.map((n) => {
          const active = n.section === activeSection;
          const base =
            "px-3 py-1.5 text-xs font-semibold rounded-full transition-colors";
          return (
            <a
              key={n.section}
              href={hubSectionHref(n.section, ctx)}
              aria-current={active ? "page" : undefined}
              className={`${base} ${
                active
                  ? "bg-ih-primary text-ih-fg-inverse"
                  : "text-ih-fg-3 hover:bg-ih-bg-muted"
              }`}
            >
              {n.label}
            </a>
          );
        })}
      </nav>

      {/* Overview body */}
      <InspectionStatusCards overview={overview} />
    </div>
  );
}
