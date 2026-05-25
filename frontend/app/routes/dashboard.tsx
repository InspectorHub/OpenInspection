import { useState, useCallback } from "react";
import { useLoaderData, Link, useNavigate } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { NewInspectionWizard } from "~/components/NewInspectionWizard";
import { CommandPalette } from "~/components/CommandPalette";

export function meta() {
  return [{ title: "Dashboard - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Inspection {
  id: string;
  date: string | null;
  address: string | null;
  clientName: string | null;
  status: string;
  confirmedAt?: string | null;
  price?: number | null;
  defectStats?: { safety: number; recommendation: number; maintenance: number };
}

interface DashboardData {
  needsAttention: Inspection[];
  today: Inspection[];
  thisWeek: Inspection[];
  later: Inspection[];
  recentReports: Inspection[];
  cancelled: Inspection[];
  conciergePending?: number;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections/dashboard", { token });
    const json = res.ok ? await res.json() : {};
    const d = (json as Record<string, unknown>)?.data as DashboardData | undefined;
    return {
      buckets: {
        needsAttention: d?.needsAttention ?? [],
        today: d?.today ?? [],
        thisWeek: d?.thisWeek ?? [],
        later: d?.later ?? [],
        recentReports: d?.recentReports ?? [],
        cancelled: d?.cancelled ?? [],
      } satisfies Record<string, Inspection[]>,
      conciergePending: d?.conciergePending ?? 0,
      greeting: getGreeting(),
    };
  } catch {
    return {
      buckets: {
        needsAttention: [] as Inspection[],
        today: [] as Inspection[],
        thisWeek: [] as Inspection[],
        later: [] as Inspection[],
        recentReports: [] as Inspection[],
        cancelled: [] as Inspection[],
      },
      conciergePending: 0,
      greeting: getGreeting(),
    };
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ------------------------------------------------------------------ */
/*  Workflow tabs                                                       */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "drafts", label: "Drafts" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "published", label: "Published" },
  { key: "cancelled", label: "Cancelled" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function filterByTab(buckets: Record<string, Inspection[]>, tab: TabKey): Record<string, Inspection[]> {
  if (tab === "all") return buckets;
  const statusMap: Record<string, string[]> = {
    active: ["confirmed", "in_progress"],
    drafts: ["draft"],
    awaiting_payment: ["awaiting_payment"],
    published: ["completed", "delivered"],
    cancelled: ["cancelled"],
  };
  const allowed = statusMap[tab] ?? [];
  const result: Record<string, Inspection[]> = {};
  for (const [key, items] of Object.entries(buckets)) {
    const filtered = items.filter((i) => allowed.includes(i.status));
    if (filtered.length > 0) result[key] = filtered;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Bucket labels                                                      */
/* ------------------------------------------------------------------ */

const BUCKET_META: Record<string, { label: string; hint: string }> = {
  needsAttention: { label: "Needs Attention", hint: "Inspections requiring action" },
  today: { label: "Today", hint: "Scheduled for today" },
  thisWeek: { label: "This Week", hint: "Upcoming this week" },
  later: { label: "Later", hint: "Future inspections" },
  recentReports: { label: "Recent Reports", hint: "Recently completed" },
  cancelled: { label: "Cancelled", hint: "Cancelled inspections" },
};

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { buckets, conciergePending, greeting } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const allInspections = Object.values(buckets).flat();
  const counts = {
    upcoming: buckets.today.length + buckets.thisWeek.length + buckets.later.length,
    inProgress: allInspections.filter((i) => i.status === "in_progress" || i.status === "confirmed").length,
    needsAttention: buckets.needsAttention.length,
    recent: buckets.recentReports.length,
  };

  const filteredBuckets = filterByTab(buckets, activeTab);
  const totalFiltered = Object.values(filteredBuckets).flat().length;

  const toggleBucket = (key: string) =>
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  /* ---- CSV export ---- */
  const exportCsv = useCallback(() => {
    const rows = Object.values(filteredBuckets).flat();
    if (rows.length === 0) return;
    const header = ["Address", "Client", "Date", "Status", "Price"];
    const csvRows = [
      header.join(","),
      ...rows.map((i) =>
        [
          `"${(i.address || "").replace(/"/g, '""')}"`,
          `"${(i.clientName || "").replace(/"/g, '""')}"`,
          i.date || "",
          i.status,
          i.price != null ? String(i.price) : "",
        ].join(","),
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inspections-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredBuckets]);

  /* ---- Stat cards ---- */
  const statCards = [
    { label: "Upcoming", count: counts.upcoming, color: "indigo" as const, icon: CalendarIcon },
    { label: "In Progress", count: counts.inProgress, color: "blue" as const, icon: ClockIcon },
    { label: "Needs Attention", count: counts.needsAttention, color: "amber" as const, icon: AlertIcon },
    { label: "Recent Reports", count: counts.recent, color: "emerald" as const, icon: FileIcon },
  ];

  const colorMap = {
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
  };

  return (
    <div className="space-y-[18px]">
      {/* PageHeader */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Dashboard
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">{greeting}</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
            {counts.upcoming} upcoming{" "}
            {counts.upcoming === 1 ? "inspection" : "inspections"}
            {counts.needsAttention > 0 && (
              <span>
                {" "}&middot; {counts.needsAttention}{" "}
                {counts.needsAttention === 1 ? "report needs" : "reports need"} attention
              </span>
            )}
            {conciergePending > 0 && (
              <span>
                {" "}&middot; {conciergePending} pending{" "}
                {conciergePending === 1 ? "booking" : "bookings"}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setFiltersOpen(true)} className="h-8 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5">
            <FilterIcon />
            Filters
          </button>
          <button onClick={() => setColumnsOpen(true)} className="h-8 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5">
            <ColumnsIcon />
            Columns
          </button>
          <button onClick={exportCsv} className="h-8 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5">
            <ExportIcon />
            Export
          </button>
          <button
            onClick={() => setWizardOpen(true)}
            className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-1.5 transition-colors"
          >
            + New Inspection
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="p-[14px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorMap[card.color]}`}>
                <card.icon />
              </div>
              <div>
                <p className="text-[22px] font-bold leading-tight text-slate-900 dark:text-white">
                  {card.count}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{card.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Workflow tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
              activeTab === tab.key
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inspection buckets */}
      {totalFiltered === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
            <ClipboardIcon />
          </div>
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            No inspections yet
          </p>
          <p className="text-[13px] text-slate-500 mt-1">
            Create one above to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(filteredBuckets).map(([key, items]) => {
            if (items.length === 0) return null;
            const meta = BUCKET_META[key] ?? { label: key, hint: "" };
            const collapsed = collapsedBuckets.has(key);
            return (
              <div
                key={key}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => toggleBucket(key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {meta.hint}
                    </span>
                    <span className="text-[11px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-400 px-1.5 py-0.5 rounded">
                      {items.length}
                    </span>
                  </div>
                  <ChevronIcon collapsed={collapsed} />
                </button>
                {!collapsed && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {items.map((insp) => (
                      <Link
                        key={insp.id}
                        to={`/inspections/${insp.id}/edit`}
                        className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
                            {insp.address || "No address"}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {insp.clientName || "No client"}
                            {insp.date && <span> &middot; {insp.date}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          {insp.defectStats && (
                            <div className="flex gap-1">
                              {insp.defectStats.safety > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                  {insp.defectStats.safety}S
                                </span>
                              )}
                              {insp.defectStats.recommendation > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                                  {insp.defectStats.recommendation}R
                                </span>
                              )}
                              {insp.defectStats.maintenance > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                                  {insp.defectStats.maintenance}M
                                </span>
                              )}
                            </div>
                          )}
                          {insp.price != null && (
                            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              ${insp.price}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Wizard modal */}
      <NewInspectionWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* Command Palette */}
      <CommandPalette onNewInspection={() => setWizardOpen(true)} />

      {/* Filters modal (placeholder) */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setFiltersOpen(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold">Filters</h2>
              <button onClick={() => setFiltersOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg">&times;</button>
            </div>
            <p className="text-[13px] text-slate-500">Filter options will appear here. (Coming soon)</p>
          </div>
        </div>
      )}

      {/* Columns modal (placeholder) */}
      {columnsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setColumnsOpen(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold">Columns</h2>
              <button onClick={() => setColumnsOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg">&times;</button>
            </div>
            <p className="text-[13px] text-slate-500">Column visibility settings will appear here. (Coming soon)</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

function CalendarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M10.29 3.86l-8.6 14.86A1 1 0 002.56 20h18.88a1 1 0 00.87-1.28l-8.6-14.86a1 1 0 00-1.72 0z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-slate-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
