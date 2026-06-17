import type React from "react";
import { Link } from "react-router";
import { brandTokens, type TenantBrand } from "~/lib/brand";
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
  | "repair"
  | "documents";

export interface HubLinkCtx {
  tenant: string;
  inspectionId: string;
  token: string;
}

/* ------------------------------------------------------------------ */
/* Pure model (unit-tested) */
/* ------------------------------------------------------------------ */

/**
 * Inline section nav target: a `?section=` query on THIS hub page.
 * Client-side <Link> navigation re-runs the loader without a full reload, so the
 * header + nav stay rendered. The per-inspection ?token= is preserved when
 * present (email-CTA arrivals carry it; magic-link sessions don't need it).
 */
export function hubSectionNavHref(section: HubSection, ctx: HubLinkCtx): string {
  const { tenant, inspectionId, token } = ctx;
  const params = new URLSearchParams();
  if (section !== "overview") params.set("section", section);
  if (token) params.set("token", token);
  const qs = params.toString();
  return `/portal/${tenant}/i/${inspectionId}${qs ? `?${qs}` : ""}`;
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
  { section: "documents", label: "Documents" },
];

export default function InspectionHub({
  overview,
  ctx,
  brand,
  activeSection = "overview",
  sectionSlot,
  onSignOut,
}: {
  overview: StatusOverview;
  ctx: HubLinkCtx;
  /** Tenant brand (logo / company name / accent color). When set, the accent
   *  re-points the DS primary tokens via brandTokens so active tabs + the Sign
   *  out hover adopt it; the logo / company name show as a small brand line.
   *  Degrades gracefully (generic shell) when omitted or fields are null. */
  brand?: TenantBrand;
  activeSection?: HubSection;
  /** The active (non-overview) section's rendered body, supplied by the route
   *  so this component stays presentational/data-source-agnostic. Ignored on
   *  the "overview" tab (which always renders the status cards). */
  sectionSlot?: React.ReactNode;
  /** Optional sign-out callback (clears the portal session + redirects). Owned by
   *  the route so this component stays presentational/SSR-safe. When omitted, no
   *  Sign out control is rendered. */
  onSignOut?: () => void;
}) {
  return (
    <div style={brandTokens(brand?.primaryColor)} className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header — always rendered for every section. */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* Brand line — tenant logo and/or company name above the address.
              Hidden entirely when the tenant has no logo/name. */}
          {(brand?.logoUrl || brand?.siteName) && (
            <div className="mb-2 flex items-center gap-2">
              {brand.logoUrl && (
                <img
                  src={brand.logoUrl}
                  alt={brand.siteName ?? "Company"}
                  className="h-8 w-auto"
                />
              )}
              {brand.siteName && (
                <span className="text-[13px] font-semibold text-ih-fg-3">{brand.siteName}</span>
              )}
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight text-ih-fg-1">
            {overview.address || "Inspection"}
          </h1>
          {overview.date && <p className="mt-1 text-sm text-ih-fg-3">{overview.date}</p>}
        </div>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="shrink-0 h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
          >
            Sign out
          </button>
        )}
      </div>

      {/* Top nav — client-side <Link>s switching the ?section= query. */}
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-ih-border pb-3">
        {NAV.map((n) => {
          const active = n.section === activeSection;
          const base =
            "px-3 py-1.5 text-xs font-semibold rounded-full transition-colors";
          return (
            <Link
              key={n.section}
              to={hubSectionNavHref(n.section, ctx)}
              aria-current={active ? "page" : undefined}
              className={`${base} ${
                active
                  ? "bg-ih-primary text-ih-fg-inverse"
                  : "text-ih-fg-3 hover:bg-ih-bg-muted"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* Body — overview shows the status cards; any other section renders the
          route-supplied slot. */}
      {activeSection === "overview" ? (
        <InspectionStatusCards overview={overview} />
      ) : (
        <section className="mt-2">{sectionSlot}</section>
      )}
    </div>
  );
}
