import type React from "react";
import { Link } from "react-router";
import { brandTokens, type TenantBrand } from "~/lib/brand";
import InspectionStatusCards, { reportLockNotice, type StatusOverview } from "./InspectionStatusCards";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { m } from "~/paraglide/messages";

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
  | "documents"
  // Reached from the BELL, never from navItems() below: the eight tabs are
  // facts about this inspection and this is a fact about the reader.
  | "notifications";

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

// Factory (not a module const) so the labels resolve inside the request's
// paraglide scope on each render rather than being frozen at import time.
function navItems(): Array<{ section: HubSection; label: string }> {
  return [
    { section: "overview", label: m.portal_hub_nav_overview() },
    { section: "report", label: m.portal_hub_nav_report() },
    { section: "agreement", label: m.portal_hub_nav_agreement() },
    { section: "payment", label: m.portal_hub_nav_payment() },
    { section: "progress", label: m.portal_hub_nav_progress() },
    { section: "messages", label: m.portal_hub_nav_messages() },
    { section: "repair", label: m.portal_hub_nav_repair() },
    { section: "documents", label: m.portal_hub_nav_documents() },
  ];
}

export default function ClientPortalHub({
  overview,
  ctx,
  brand,
  activeSection = "overview",
  sectionSlot,
  onSignOut,
  agentMode = false,
  bellSlot,
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
  /** Agent-mode (Spec 3): the viewer opened an agent report link (token-only,
   *  no client session). The server already forces section='report', so this
   *  hides the client-only tab bar — an agent has no overview/agreement/payment/
   *  messages/repair/documents hub, only the report + the AgentReportActions CTA. */
  agentMode?: boolean;
  /** Notices bell (design §3.15: a bell is always "sent to me"). Supplied by
   *  the route so this component stays presentational; omitted in agent mode,
   *  where the viewer holds a report token and has no inbox here. */
  bellSlot?: React.ReactNode;
}) {
  return (
    <div style={brandTokens(brand?.primaryColor)} className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header — always rendered for every section. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Brand line — tenant logo and/or company name above the address.
              Hidden entirely when the tenant has no logo/name. */}
          {(brand?.logoUrl || brand?.companyName) && (
            <div className="mb-2 flex items-center gap-2">
              {brand.logoUrl && (
                <img
                  src={brand.logoUrl}
                  alt={brand.companyName ?? m.portal_brand_logo_alt()}
                  className="h-8 w-auto"
                />
              )}
              {brand.companyName && (
                <span className="text-[13px] font-semibold text-ih-fg-3">{brand.companyName}</span>
              )}
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight text-ih-fg-1">
            {overview.address || m.portal_address_fallback()}
          </h1>
          {overview.date && <p className="mt-1 text-sm text-ih-fg-3">{overview.date}</p>}
        </div>
        {/* Right cluster — shared theme control (consistent with the tenant app
            and agent portal), plus Sign out for a client session. The client
            portal is heavily mobile, so the control stays visible at every width
            and the header wraps rather than colliding with the address. */}
        <div className="flex items-center gap-2 shrink-0">
          {bellSlot}
          <ThemeSegmentControl />
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="shrink-0 h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
            >
              {m.portal_signout()}
            </button>
          )}
        </div>
      </div>

      {/* Top nav — client-side <Link>s switching the ?section= query. Hidden in
          agent mode: an agent report link has only the report section. */}
      {!agentMode && (
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-ih-border pb-3">
        {navItems().map((n) => {
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
      )}

      {/* Body — overview shows the status cards; any other section renders the
          route-supplied slot. */}
      {activeSection === "overview" ? (
        <OverviewBody overview={overview} ctx={ctx} />
      ) : (
        <section className="mt-2">{sectionSlot}</section>
      )}
    </div>
  );
}

/**
 * IA-45 — overview body: an inline "why the report is locked + next step"
 * notice (absorbed from the retired /report-gate page) above the status cards.
 * The notice only appears when an agreement or payment is outstanding.
 */
function OverviewBody({ overview, ctx }: { overview: StatusOverview; ctx: HubLinkCtx }) {
  const lock = reportLockNotice(overview);
  return (
    <>
      {lock && (
        <div className="mb-3 rounded-lg border border-ih-watch bg-ih-watch-bg p-4">
          <p className="text-sm font-semibold text-ih-watch-fg">
            {m.portal_report_lock_heading()}
          </p>
          <p className="mt-1 text-[13px] text-ih-watch-fg">
            {lock.reason === "agreement"
              ? m.portal_report_lock_agreement_body()
              : m.portal_report_lock_payment_body()}
          </p>
          <Link
            to={hubSectionNavHref(lock.section, ctx)}
            className="mt-3 inline-flex items-center justify-center h-9 px-4 rounded-md text-[13px] font-bold text-ih-primary-fg bg-ih-primary hover:opacity-95 transition"
          >
            {lock.reason === "agreement"
              ? m.portal_report_lock_agreement_cta()
              : m.portal_report_lock_payment_cta()}
          </Link>
        </div>
      )}
      <InspectionStatusCards overview={overview} />
    </>
  );
}
