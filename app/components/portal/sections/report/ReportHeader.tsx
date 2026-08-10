/**
 * <ReportHeader> — the report masthead: the company mark and certification
 * line, the top-bar reader actions (build a repair request, Print, open the
 * in-report Repair Request panel), the property-address title, the
 * inspector/date line and the inspector's credential badges.
 *
 * One unit because it is what the client sees before scrolling: who produced
 * this report, for what property, when, and what they can do with it.
 *
 * Two gates run through it and are easy to get backwards:
 *  - `standalone` — the big ADDRESS title renders ONLY on the standalone
 *    `/report-view/...` page. Inline in the Hub the page header already shows
 *    the address, so repeating it here duplicates it. The inspector/date cert
 *    line stays in BOTH modes: it is content, not chrome.
 *  - `hideClientActions` — an AGENT viewing the report loses the client's
 *    transaction affordances (build-repair link, Repair Request toggle) but
 *    keeps the report-viewing ones (Print).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import { brandFormat, type TenantBrand } from "~/lib/brand";
import { formatInspectionDateTime } from "~/lib/format-date";
import { CredentialBadges, type CredentialItem } from "./CredentialBadges";
import { REPORT_HEADING_STYLE } from "./types";

export interface ReportHeaderProps {
  brand: TenantBrand;
  tenant: string;
  reportId: string;
  /** Public access token (?token=), for token-scoped action links. */
  token?: string;
  /** Standalone page → render the big property-address title. */
  standalone: boolean;
  address: string;
  date: string;
  /** Tenant timezone (IANA) the displayed date is anchored to. */
  reportTimeZone: string;
  inspectorName: string | null;
  inspectorCredentials?: CredentialItem[];
  /** Resolved style-profile badge layout; defaults to the strip. */
  badgeLayout?: "strip" | "inline";
  /** Agent view: drop the client's transaction affordances. */
  hideClientActions?: boolean;
  enableCustomerRepairExport: boolean;
  onToggleRepairPanel: () => void;
}

export function ReportHeader({
  brand,
  tenant,
  reportId,
  token,
  standalone,
  address,
  date,
  reportTimeZone,
  inspectorName,
  inspectorCredentials,
  badgeLayout,
  hideClientActions,
  enableCustomerRepairExport,
  onToggleRepairPanel,
}: ReportHeaderProps) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-6">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.companyName ?? m.report_view_logo_alt()} className="h-10 w-auto" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-ih-ok/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-ih-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
          <span className="text-xs font-semibold tracking-widest uppercase text-ih-fg-3">
            {brand.companyName ? m.report_view_cert_with_company({ company: brand.companyName }) : m.report_view_cert()}
          </span>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {/* IA-68 — the "View Repair List" button pointed at
              /inspections/:id/repair-list, a page route that does not exist
              (only the API route does), so it 404'd. The "Build repair
              request" button below already reaches the real repair capability;
              the dead affordance is removed rather than pointed somewhere new. */}
          {!hideClientActions && enableCustomerRepairExport && (
            <a
              href={`/repair-builder/${tenant}/${reportId}${token ? `?token=${encodeURIComponent(token)}` : ""}`}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
            >
              {m.report_view_build_repair()}
            </a>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
          >
            {m.report_view_print()}
          </button>
          {!hideClientActions && (
            <button
              type="button"
              onClick={onToggleRepairPanel}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-ih-primary-fg flex items-center gap-2"
            >
              {m.portal_hub_nav_repair()}
            </button>
          )}
        </div>
      </div>
      {standalone && (
        <h1 className="text-2xl sm:text-3xl leading-tight mb-2 text-ih-fg-1" style={REPORT_HEADING_STYLE}>
          {address}
        </h1>
      )}
      <p className="text-sm text-ih-fg-3">
        {date ? `${formatInspectionDateTime(date, undefined, reportTimeZone, brandFormat(brand))} · ` : ""}
        {m.report_view_inspector({ name: inspectorName || m.report_view_na() })}
      </p>
      {inspectorCredentials && inspectorCredentials.length > 0 && (
        <CredentialBadges credentials={inspectorCredentials} layout={badgeLayout ?? "strip"} />
      )}
    </div>
  );
}
