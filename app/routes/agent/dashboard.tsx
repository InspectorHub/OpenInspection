import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export function meta() {
 return [{ title: "Agent Dashboard - OpenInspection" }];
}

interface Referral {
 id: string;
 tenantName: string;
 tenantSlug: string;
 propertyAddress: string | null;
 clientName: string | null;
 date: string | null;
 status: string;
 reportStatus: string | null;
 inspectorName: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 try {
 const api = createApi(context, { token });
 const res = await api.agent.referrals.$get();
 const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
 return {
 referrals: (body.data ?? []) as Referral[],
 unreadReports: (typeof body?.unreadReports === "number" ? body.unreadReports : 0) as number,
 };
 } catch {
 return { referrals: [] as Referral[], unreadReports: 0 };
 }
}

function statusLabel(s: string): string {
 const map: Record<string, string> = {
 draft: "Booked", scheduled: "Scheduled", confirmed: "Confirmed",
 in_progress: "On site", completed: "Completed", delivered: "Published",
 cancelled: "Cancelled",
 };
 return map[s.toLowerCase()] || s || "Pending";
}

function statusColor(s: string): string {
 const lower = s.toLowerCase();
 if (lower === "delivered") return "bg-ih-ok-bg text-ih-ok-fg";
 if (lower === "in_progress" || lower === "completed") return "bg-ih-info-bg text-ih-info-fg";
 if (lower === "cancelled") return "bg-ih-bad-bg text-ih-bad-fg";
 return "bg-ih-bg-muted text-ih-fg-2";
}

export default function AgentDashboardPage() {
 const { referrals, unreadReports } = useLoaderData<typeof loader>();

 // Group by tenant
 const grouped = new Map<string, Referral[]>();
 for (const r of referrals) {
 const existing = grouped.get(r.tenantName) || [];
 existing.push(r);
 grouped.set(r.tenantName, existing);
 }
 const sections = Array.from(grouped.entries());

 return (
 <div className="space-y-6">
 <div>
 <h1 className="text-[28px] font-bold tracking-tight text-ih-fg-1">Agent Dashboard</h1>
 <p className="text-[14px] text-ih-fg-3 mt-1">
 Your referrals across every team you partner with.
 </p>
 </div>

 {/* Stat cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
 <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">Active Referrals</p>
 <p className="text-3xl font-bold text-ih-fg-1">{referrals.length}</p>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 Across {sections.length} {sections.length === 1 ? "team" : "teams"}
 </p>
 </div>
 <div className={`bg-ih-bg-card border border-ih-border rounded-xl p-5 ${unreadReports > 0 ? "border-ih-primary/40" : ""}`}>
 <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">Reports Ready to Read</p>
 <p className={`text-3xl font-bold ${unreadReports > 0 ? "text-ih-primary" : "text-ih-fg-1"}`}>
 {unreadReports}
 </p>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 {unreadReports === 0 ? "You're all caught up" : "Tap a row below to open"}
 </p>
 </div>
 </div>

 {/* Referrals by tenant */}
 {sections.length === 0 ? (
 <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
 <h3 className="text-lg font-bold text-ih-fg-1 mb-2">No referrals yet</h3>
 <p className="text-[13px] text-ih-fg-3 max-w-md mx-auto">
 Inspectors invite agents from their contacts list. Once you are linked,
 every inspection you refer lands here.
 </p>
 <Link
 to="/agent-settings/profile"
 className="inline-flex items-center mt-4 h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
 >
 Set up your referral slug
 </Link>
 </div>
 ) : (
 sections.map(([tenantName, rows]) => (
 <div key={tenantName} className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden">
 <div className="flex items-center gap-3 px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border">
 <span className="w-1 h-6 rounded bg-ih-primary" />
 <span className="text-sm font-bold text-ih-fg-1">{tenantName}</span>
 <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest ml-auto">
 {rows.length} {rows.length === 1 ? "referral" : "referrals"}
 </span>
 </div>
 <div className="divide-y divide-ih-border">
 {rows.map((r) => (
 <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted/30 transition-colors gap-3">
 <div className="min-w-0 flex-1">
 <p className="text-[13px] font-semibold text-ih-fg-1 truncate">
 {r.propertyAddress || "No address"}
 </p>
 <p className="text-[11px] text-ih-fg-3 mt-0.5">
 {r.clientName || "No client"}{r.date ? ` · ${r.date}` : ""}
 {r.inspectorName ? ` · w/ ${r.inspectorName}` : ""}
 </p>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 {r.reportStatus === "published" && r.tenantSlug && (
 <Link
 to={`/repair-builder/${r.tenantSlug}/${r.id}`}
 className="inline-flex items-center h-6 px-2 rounded border border-ih-border text-[11px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
 >
 Build repair request
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
