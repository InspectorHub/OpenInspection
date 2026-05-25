import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/reports";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Reports - OpenInspection" }];
}

interface Report {
  id: string;
  address: string | null;
  clientName: string | null;
  date: string | null;
  status: string;
  paymentStatus: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections?status=completed,delivered", { token });
    const data = res.ok ? await res.json() : {};
    return { reports: ((data as any)?.data || []) as Report[] };
  } catch {
    return { reports: [] as Report[] };
  }
}

const TABS = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready for Review" },
  { id: "delivered", label: "Delivered" },
  { id: "signed", label: "Signed" },
];

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  delivered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  signed: "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
};

function statusLabel(s: string): string {
  if (s === "completed") return "Ready";
  if (s === "delivered") return "Delivered";
  if (s === "signed") return "Signed";
  return s;
}

export default function ReportsPage() {
  const { reports } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = reports.filter((r) => {
    if (activeTab === "ready" && r.status !== "completed") return false;
    if (activeTab === "delivered" && r.status !== "delivered") return false;
    if (activeTab === "signed" && r.status !== "signed") return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.address?.toLowerCase().includes(q) || r.clientName?.toLowerCase().includes(q));
    }
    return true;
  });

  const tabsWithCount = TABS.map((t) => ({
    ...t,
    count: t.id === "all" ? reports.length
      : t.id === "ready" ? reports.filter((r) => r.status === "completed").length
      : t.id === "delivered" ? reports.filter((r) => r.status === "delivered").length
      : reports.filter((r) => r.status === "signed").length,
  }));

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="REPORTS"
        eyebrowColor="emerald"
        title="Reports"
        meta={`${reports.length} ${reports.length === 1 ? "report" : "reports"}`}
        actions={
          <input
            type="search"
            placeholder="Search address, client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64 px-3 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-[13px] font-medium placeholder:text-slate-400"
          />
        }
      />

      <TabStrip tabs={tabsWithCount} activeId={activeTab} onChange={setActiveTab} />

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
          <EmptyState
            title="No reports found"
            description={search ? "Try a different search term." : "Published inspection reports will appear here."}
          />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Property</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Client</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Date</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Payment</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="py-3 px-4 text-[13px] font-medium text-slate-900 dark:text-slate-100 max-w-[240px] truncate">
                      {r.address || "No address"}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">
                      {r.clientName || "No client"}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-500 dark:text-slate-400">
                      {r.date || "—"}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${STATUS_STYLES[r.status] || "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-500 dark:text-slate-400">
                      {r.paymentStatus || "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        to={`/inspections/${r.id}/edit`}
                        className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-700">
            {filtered.map((r) => (
              <Link
                key={r.id}
                to={`/inspections/${r.id}/edit`}
                className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
                    {r.address || "No address"}
                  </p>
                  <span className={`inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-[0.04em] ml-2 shrink-0 ${STATUS_STYLES[r.status] || "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}>
                    {statusLabel(r.status)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {r.clientName || "No client"} {r.date && <>&middot; {r.date}</>}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
