import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Agent Dashboard - OpenInspection" }];
}

interface Referral {
  id: string;
  tenantName: string;
  propertyAddress: string | null;
  clientName: string | null;
  date: string | null;
  status: string;
  inspectorName: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/referrals", { token });
    const data = res.ok ? await res.json() : {};
    return {
      referrals: ((data as any)?.data?.referrals || []) as Referral[],
      unreadReports: ((data as any)?.data?.unreadReports || 0) as number,
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
  if (lower === "delivered") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400";
  if (lower === "in_progress" || lower === "completed") return "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400";
  if (lower === "cancelled") return "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400";
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
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-white">Agent Dashboard</h1>
        <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1">
          Your referrals across every team you partner with.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active Referrals</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white">{referrals.length}</p>
          <p className="text-[13px] text-slate-500 mt-1">
            Across {sections.length} {sections.length === 1 ? "team" : "teams"}
          </p>
        </div>
        <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 ${unreadReports > 0 ? "border-indigo-300 dark:border-indigo-700" : ""}`}>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Reports Ready to Read</p>
          <p className={`text-3xl font-bold ${unreadReports > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-slate-900 dark:text-white"}`}>
            {unreadReports}
          </p>
          <p className="text-[13px] text-slate-500 mt-1">
            {unreadReports === 0 ? "You're all caught up" : "Tap a row below to open"}
          </p>
        </div>
      </div>

      {/* Referrals by tenant */}
      {sections.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No referrals yet</h3>
          <p className="text-[13px] text-slate-500 max-w-md mx-auto">
            Inspectors invite agents from their contacts list. Once you are linked,
            every inspection you refer lands here.
          </p>
          <Link
            to="/agent-settings/profile"
            className="inline-flex items-center mt-4 h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors"
          >
            Set up your referral slug
          </Link>
        </div>
      ) : (
        sections.map(([tenantName, rows]) => (
          <div key={tenantName} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
              <span className="w-1 h-6 rounded bg-indigo-500" />
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{tenantName}</span>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-auto">
                {rows.length} {rows.length === 1 ? "referral" : "referrals"}
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {r.propertyAddress || "No address"}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {r.clientName || "No client"}{r.date ? ` · ${r.date}` : ""}
                      {r.inspectorName ? ` · w/ ${r.inspectorName}` : ""}
                    </p>
                  </div>
                  <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] shrink-0 ml-4 ${statusColor(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
