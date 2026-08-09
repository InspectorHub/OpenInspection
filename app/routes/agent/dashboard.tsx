import { useMemo, useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Banner, Select } from "@core/shared-ui";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useInspectionDateTimeFormat } from "~/hooks/useSessionContext";
import { propertyGroupKey, inspectionDateValue } from "~/lib/property-groups";
import { agentMayReadRepairList, type AgentRepairAccess } from "~/lib/agent-repair-access";
import { useAgentTimeZoneOverride } from "~/routes/agent-layout";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";

export function meta() {
 return [{ title: m.agent_portal_dashboard_meta_title() }];
}

interface Referral {
 id: string;
 tenantName: string;
 tenantSlug: string;
 /** Owning tenant's display timezone (IANA; 'UTC' when unset). */
 tenantTimezone: string;
 propertyAddress: string | null;
 clientName: string | null;
 date: string | null;
 status: string;
 reportStatus: string | null;
 inspectorName: string | null;
 /** This company's policy for agents on its repair list (IA-35). */
 repairAccess: AgentRepairAccess;
}

export async function loader({ request, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 // Conversion-flow highlight (Task 4c): a converting agent lands here with
 // ?welcome=<inspectionId> — that inspection is already auto-linked into
 // their referrals server-side, so we just read the id and let the render
 // highlight the matching row.
 const welcomeInspectionId = new URL(request.url).searchParams.get("welcome");
 try {
 const api = createApi(context, { token });
 const res = await api.agent.referrals.$get();
 const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
 return {
 referrals: (body.data ?? []) as Referral[],
 unreadReports: (typeof body?.unreadReports === "number" ? body.unreadReports : 0) as number,
 welcomeInspectionId,
 loadFailed: false,
 };
 } catch {
 return { referrals: [] as Referral[], unreadReports: 0, welcomeInspectionId, loadFailed: true };
 }
}

function statusLabel(s: string): string {
 switch (s.toLowerCase()) {
 case "draft": return m.agent_portal_status_booked();
 case "scheduled": return m.agent_portal_status_scheduled();
 case "confirmed": return m.agent_portal_status_confirmed();
 case "in_progress": return m.agent_portal_status_on_site();
 case "completed": return m.agent_portal_status_completed();
 case "delivered": return m.agent_portal_status_published();
 case "cancelled": return m.agent_portal_status_cancelled();
 default: return s || m.agent_portal_status_pending();
 }
}

function statusColor(s: string): string {
 const lower = s.toLowerCase();
 if (lower === "delivered") return "bg-ih-ok-bg text-ih-ok-fg";
 if (lower === "in_progress" || lower === "completed") return "bg-ih-info-bg text-ih-info-fg";
 if (lower === "cancelled") return "bg-ih-bad-bg text-ih-bad-fg";
 return "bg-ih-bg-muted text-ih-fg-2";
}

export default function AgentDashboardPage() {
 const { referrals, unreadReports, welcomeInspectionId, loadFailed } = useLoaderData<typeof loader>();
 const [welcomeDismissed, setWelcomeDismissed] = useState(false);
 // Referral-date timezone resolution (agents are global users spanning many
 // tenants, so there is no single "the agent's tenant tz"):
 //   1. the agent's personal override, when set — applied to every row;
 //   2. else each row's owning-tenant tz (tenant_configs.default_timezone);
 //   3. else 'UTC' — which is also the tenant's own unconfigured fallback, so
 //      an agent with no override sees exactly what that company would show.
 // formatInspectionDateTime stamps the short zone label so the time reads
 // unambiguously, and reuses the same shared formatter as the inspector hub.
 // Note: inspections.date is a mixed column — bookings/create store a full ISO
 // datetime (rendered in the resolved zone), while an explicit YYYY-MM-DD is
 // shown as a plain UTC-anchored date with no time/zone (so the resolved tz has
 // no visible effect there, which is correct — it avoids a prior-day rollover).
 const agentTz = useAgentTimeZoneOverride();
 // #270 — an agent spans many tenants, so the SHAPE cannot come from one of
 // them the way the inspector hub's does; the agent's own preference governs
 // their list, and each row still names its zone.
 const fmt = useInspectionDateTimeFormat();

 // Task 4c: the referral matching a conversion-flow ?welcome=<id>, if it has
 // shown up in this agent's referrals yet (server-side auto-link can lag a
 // beat behind the redirect).
 const welcomeReferral = welcomeInspectionId
 ? referrals.find((r) => r.id === welcomeInspectionId) ?? null
 : null;

 // Company filter (SECONDARY). The inspection company is just one vendor on a
 // deal, so it is a filter — not the top-level grouping (IA-51). Distinct
 // companies drive both the dropdown and the "across N teams" stat.
 const [companyFilter, setCompanyFilter] = useState<string>("");
 const companies = useMemo(
 () => Array.from(new Set(referrals.map((r) => r.tenantName))).sort((a, b) => a.localeCompare(b)),
 [referrals],
 );

 // Group by PROPERTY / transaction, NOT by company (IA-51). An agent's unit of
 // work is the deal, so the first-level heading is the address; two referrals at
 // the same address from different companies collapse into one group of two rows
 // rather than being split across company sections. An agent landing from a
 // report email (context = one property) then finds that property at the top
 // level instead of having to recall which company inspected it. Groups sort by
 // most-recent inspection date; the just-converted ?welcome group is pinned
 // first, with its row pinned within so "welcome" always lands on something
 // visible.
 const sections = useMemo(() => {
 const visible = companyFilter ? referrals.filter((r) => r.tenantName === companyFilter) : referrals;
 const groups = new Map<string, { label: string; rows: Referral[]; recency: number }>();
 for (const r of visible) {
 const key = propertyGroupKey(r.propertyAddress, r.id);
 const g = groups.get(key) || { label: r.propertyAddress?.trim() || m.agent_portal_no_address(), rows: [], recency: -Infinity };
 if (welcomeReferral && r.id === welcomeReferral.id) g.rows.unshift(r);
 else g.rows.push(r);
 g.recency = Math.max(g.recency, inspectionDateValue(r.date));
 groups.set(key, g);
 }
 return Array.from(groups.entries())
 .map(([key, g]) => ({ key, ...g, isWelcome: !!welcomeReferral && g.rows.some((r) => r.id === welcomeReferral.id) }))
 .sort((a, b) => (a.isWelcome ? -1 : b.isWelcome ? 1 : b.recency - a.recency));
 }, [referrals, companyFilter, welcomeReferral]);

 return (
 <div className="space-y-6">
      {/* IA-118 — an empty list here is a conclusion; say when it is not a real one. */}
      {loadFailed && <LoadFailedNotice />}

 {welcomeInspectionId && !welcomeDismissed && (
 <Banner tone="brand" dismissible onDismiss={() => setWelcomeDismissed(true)}>
 {m.agent_portal_dashboard_welcome_banner()}
 </Banner>
 )}
 <PageHeader title={m.agent_portal_dashboard_title()} meta={m.agent_portal_dashboard_subtitle()} />

 {/* Stat cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
 <p className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest mb-1">{m.agent_portal_dashboard_active_referrals()}</p>
 <p className="text-3xl font-bold text-ih-fg-1">{referrals.length}</p>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 {companies.length === 1
 ? m.agent_portal_dashboard_across_team_one({ count: companies.length })
 : m.agent_portal_dashboard_across_team_other({ count: companies.length })}
 </p>
 </div>
 <div className={`bg-ih-bg-card border border-ih-border rounded-xl p-5 ${unreadReports > 0 ? "border-ih-primary/40" : ""}`}>
 <p className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest mb-1">{m.agent_portal_dashboard_reports_ready()}</p>
 <p className={`text-3xl font-bold ${unreadReports > 0 ? "text-ih-primary" : "text-ih-fg-1"}`}>
 {unreadReports}
 </p>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 {unreadReports === 0 ? m.agent_portal_dashboard_caught_up() : m.agent_portal_dashboard_tap_open()}
 </p>
 </div>
 </div>

 {/* Company filter (secondary to the property grouping) — only when the
 agent partners with more than one company, otherwise it is noise. */}
 {companies.length > 1 && (
 <div className="flex justify-end">
 <Select
 bare
 aria-label={m.agent_portal_dashboard_filter_by_company()}
 value={companyFilter}
 onChange={(e) => setCompanyFilter(e.target.value)}
 className="max-w-xs"
 options={[
 { value: "", label: m.agent_portal_dashboard_all_companies() },
 ...companies.map((c) => ({ value: c, label: c })),
 ]}
 />
 </div>
 )}

 {/* Referrals grouped by property/transaction */}
 {sections.length === 0 ? (
 <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
 <h3 className="text-lg font-bold text-ih-fg-1 mb-2">{m.agent_portal_dashboard_empty_title()}</h3>
 <p className="text-[13px] text-ih-fg-3 max-w-md mx-auto">
 {m.agent_portal_dashboard_empty_body()}
 </p>
 <Link
 to="/agent-settings/profile"
 className="inline-flex items-center mt-4 h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
 >
 {m.agent_portal_dashboard_setup_slug()}
 </Link>
 </div>
 ) : (
 sections.map((section) => (
 <div key={section.key} className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden">
 <div className="flex items-center gap-3 px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border">
 <span className="w-1 h-6 rounded bg-ih-primary" />
 <span className="text-sm font-bold text-ih-fg-1 truncate">{section.label}</span>
 <span className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest ml-auto shrink-0">
 {section.rows.length} {section.rows.length === 1 ? m.agent_portal_dashboard_referral_one() : m.agent_portal_dashboard_referral_other()}
 </span>
 </div>
 <div className="divide-y divide-ih-border">
 {section.rows.map((r) => (
 <div
 key={r.id}
 data-testid={`referral-row-${r.id}`}
 data-welcome-highlight={welcomeReferral && r.id === welcomeReferral.id ? "true" : undefined}
 className={`flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted/30 transition-colors gap-3 ${welcomeReferral && r.id === welcomeReferral.id ? "bg-ih-primary-tint ring-1 ring-inset ring-ih-primary/30" : ""}`}
 >
 <div className="min-w-0 flex-1">
 <p className="text-[13px] font-semibold text-ih-fg-1 truncate">
 {r.tenantName}
 </p>
 <p className="text-[11px] text-ih-fg-3 mt-0.5">
 {r.clientName || m.agent_portal_dashboard_no_client()}{r.date ? ` · ${formatInspectionDateTime(r.date, undefined, agentTz || r.tenantTimezone, fmt)}` : ""}
 {r.inspectorName ? m.agent_portal_dashboard_with_inspector({ name: r.inspectorName }) : ""}
 </p>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 {/* Offer the builder only when this company lets agents in: the
 same policy the API enforces, so the link cannot lead to a 403. */}
 {r.reportStatus === "published" && r.tenantSlug && agentMayReadRepairList(r.repairAccess) && (
 <Link
 to={`/repair-builder/${r.tenantSlug}/${r.id}`}
 className="inline-flex items-center h-6 px-2 rounded border border-ih-border text-[11px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
 >
 {m.agent_portal_dashboard_build_repair()}
 </Link>
 )}
 <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${statusColor(r.status)}`}>
 {statusLabel(r.status)}
 </span>
 </div>
 </div>
 ))}
 </div>
 </div>
 ))
 )}
 </div>
 );
}
