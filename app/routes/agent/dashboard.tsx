import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Banner } from "@core/shared-ui";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useAgentTimeZoneOverride } from "~/routes/agent-layout";
import { m } from "~/paraglide/messages";

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
 };
 } catch {
 return { referrals: [] as Referral[], unreadReports: 0, welcomeInspectionId };
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
 const { referrals, unreadReports, welcomeInspectionId } = useLoaderData<typeof loader>();
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

 // Task 4c: the referral matching a conversion-flow ?welcome=<id>, if it has
 // shown up in this agent's referrals yet (server-side auto-link can lag a
 // beat behind the redirect).
 const welcomeReferral = welcomeInspectionId
 ? referrals.find((r) => r.id === welcomeInspectionId) ?? null
 : null;

 // Group by tenant, pinning the just-converted referral to the top of its
 // group so "welcome" lands on something visible, not buried in the list.
 const grouped = new Map<string, Referral[]>();
 for (const r of referrals) {
 const existing = grouped.get(r.tenantName) || [];
 if (welcomeReferral && r.id === welcomeReferral.id) {
 existing.unshift(r);
 } else {
 existing.push(r);
 }
 grouped.set(r.tenantName, existing);
 }
 const sections = Array.from(grouped.entries());

 return (
 <div className="space-y-6">
 {welcomeInspectionId && !welcomeDismissed && (
 <Banner tone="brand" dismissible onDismiss={() => setWelcomeDismissed(true)}>
 {m.agent_portal_dashboard_welcome_banner()}
 </Banner>
 )}
 <PageHeader title={m.agent_portal_dashboard_title()} meta={m.agent_portal_dashboard_subtitle()} />

 {/* Stat cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
 <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{m.agent_portal_dashboard_active_referrals()}</p>
 <p className="text-3xl font-bold text-ih-fg-1">{referrals.length}</p>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 {sections.length === 1
 ? m.agent_portal_dashboard_across_team_one({ count: sections.length })
 : m.agent_portal_dashboard_across_team_other({ count: sections.length })}
 </p>
 </div>
 <div className={`bg-ih-bg-card border border-ih-border rounded-xl p-5 ${unreadReports > 0 ? "border-ih-primary/40" : ""}`}>
 <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{m.agent_portal_dashboard_reports_ready()}</p>
 <p className={`text-3xl font-bold ${unreadReports > 0 ? "text-ih-primary" : "text-ih-fg-1"}`}>
 {unreadReports}
 </p>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 {unreadReports === 0 ? m.agent_portal_dashboard_caught_up() : m.agent_portal_dashboard_tap_open()}
 </p>
 </div>
 </div>

 {/* Referrals by tenant */}
 {sections.length === 0 ? (
 <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
 <h3 className="text-lg font-bold text-ih-fg-1 mb-2">{m.agent_portal_dashboard_empty_title()}</h3>
 <p className="text-[13px] text-ih-fg-3 max-w-md mx-auto">
 {m.agent_portal_dashboard_empty_body()}
 </p>
 <Link
 to="/agent-settings/profile"
 className="inline-flex items-center mt-4 h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
 >
 {m.agent_portal_dashboard_setup_slug()}
 </Link>
 </div>
 ) : (
 sections.map(([tenantName, rows]) => (
 <div key={tenantName} className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden">
 <div className="flex items-center gap-3 px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border">
 <span className="w-1 h-6 rounded bg-ih-primary" />
 <span className="text-sm font-bold text-ih-fg-1">{tenantName}</span>
 <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest ml-auto">
 {rows.length} {rows.length === 1 ? m.agent_portal_dashboard_referral_one() : m.agent_portal_dashboard_referral_other()}
 </span>
 </div>
 <div className="divide-y divide-ih-border">
 {rows.map((r) => (
 <div
 key={r.id}
 data-testid={`referral-row-${r.id}`}
 data-welcome-highlight={welcomeReferral && r.id === welcomeReferral.id ? "true" : undefined}
 className={`flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted/30 transition-colors gap-3 ${welcomeReferral && r.id === welcomeReferral.id ? "bg-ih-primary-tint ring-1 ring-inset ring-ih-primary/30" : ""}`}
 >
 <div className="min-w-0 flex-1">
 <p className="text-[13px] font-semibold text-ih-fg-1 truncate">
 {r.propertyAddress || m.agent_portal_no_address()}
 </p>
 <p className="text-[11px] text-ih-fg-3 mt-0.5">
 {r.clientName || m.agent_portal_dashboard_no_client()}{r.date ? ` · ${formatInspectionDateTime(r.date, undefined, agentTz || r.tenantTimezone)}` : ""}
 {r.inspectorName ? m.agent_portal_dashboard_with_inspector({ name: r.inspectorName }) : ""}
 </p>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 {r.reportStatus === "published" && r.tenantSlug && (
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
