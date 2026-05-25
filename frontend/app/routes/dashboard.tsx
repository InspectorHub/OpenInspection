import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useLoaderData, Link, useNavigate, useFetcher, useSearchParams } from "react-router";
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
  propertyAddress?: string | null;
  clientName: string | null;
  clientEmail?: string | null;
  status: string;
  confirmedAt?: string | null;
  price?: number | null;
  paymentStatus?: string | null;
  agentName?: string | null;
  agentId?: string | null;
  tagIds?: string[];
  defectStats?: { safety: number; recommendation: number; maintenance: number };
}

interface Tag {
  id: string;
  name: string;
  color?: string;
}

interface DashboardData {
  needsAttention: Inspection[];
  today: Inspection[];
  thisWeek: Inspection[];
  later: Inspection[];
  laterTotal?: number;
  recentReports: Inspection[];
  cancelled: Inspection[];
  conciergePending?: number;
}

/* ------------------------------------------------------------------ */
/*  Column registry                                                    */
/* ------------------------------------------------------------------ */

const COLUMN_REGISTRY = [
  { id: "propertyAddress", label: "Property Address", defaultOn: true, alwaysOn: true },
  { id: "clientName", label: "Client Name", defaultOn: true },
  { id: "date", label: "Inspection Date", defaultOn: true },
  { id: "inspector", label: "Inspector", defaultOn: false },
  { id: "statusIcons", label: "Status Icons", defaultOn: true },
  { id: "defectChips", label: "Defect Counts", defaultOn: true },
  { id: "agent", label: "Agent", defaultOn: true },
  { id: "price", label: "Price", defaultOn: true },
  { id: "closingDate", label: "Closing Date", defaultOn: true },
  { id: "orderId", label: "Order ID", defaultOn: false },
  { id: "referralSource", label: "Referral Source", defaultOn: false },
  { id: "propertyFacts", label: "Property Facts", defaultOn: false },
] as const;

const DEFAULT_COLUMNS = COLUMN_REGISTRY.filter((c) => c.defaultOn).map((c) => c.id);
const ALWAYS_ON = new Set(COLUMN_REGISTRY.filter((c) => c.alwaysOn).map((c) => c.id));

/* ------------------------------------------------------------------ */
/*  Time filter helpers                                                */
/* ------------------------------------------------------------------ */

const INSPECTION_FILTERS = [
  { id: "all", label: "All" },
  { id: "past", label: "Past" },
  { id: "yesterday", label: "Yesterday" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "this_week", label: "This Week" },
  { id: "future", label: "Future" },
  { id: "unconfirmed", label: "Unconfirmed" },
  { id: "in_progress", label: "In Progress" },
] as const;

type FilterId = (typeof INSPECTION_FILTERS)[number]["id"];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function matchesFilter(insp: Inspection, filter: FilterId, now: Date): boolean {
  if (filter === "all") return true;
  const status = (insp.status || "").toLowerCase();
  if (filter === "unconfirmed") return status === "scheduled" || status === "draft";
  if (filter === "in_progress") return status === "in_progress";
  if (!insp.date) return false;
  const date = new Date(insp.date);
  if (isNaN(date.getTime())) return false;
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const wkStart = startOfWeek(today);
  const wkEnd = addDays(wkStart, 7);
  const dayStart = startOfDay(date);
  switch (filter) {
    case "past": return dayStart.getTime() < today.getTime();
    case "yesterday": return dayStart.getTime() === yesterday.getTime();
    case "today": return dayStart.getTime() === today.getTime();
    case "tomorrow": return dayStart.getTime() === tomorrow.getTime();
    case "this_week": return dayStart.getTime() >= wkStart.getTime() && dayStart.getTime() < wkEnd.getTime();
    case "future": return dayStart.getTime() >= wkEnd.getTime();
  }
  return false;
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

function matchesWorkflow(i: Inspection, tab: TabKey): boolean {
  if (tab === "all") return true;
  switch (tab) {
    case "active": return i.status === "scheduled" || i.status === "in_progress" || i.status === "draft" || i.status === "confirmed";
    case "drafts": return i.status === "draft";
    case "awaiting_payment": return (i.status === "delivered" || i.status === "published") && i.paymentStatus !== "paid";
    case "published": return i.status === "delivered" || i.status === "published";
    case "cancelled": return i.status === "cancelled";
    default: return true;
  }
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const [dashRes, tagsRes] = await Promise.all([
      apiFetch("/api/inspections/dashboard", { token }),
      apiFetch("/api/tags", { token }).catch(() => null),
    ]);
    const json = dashRes.ok ? await dashRes.json() : {};
    const d = (json as Record<string, unknown>)?.data as DashboardData | undefined;
    let tags: Tag[] = [];
    if (tagsRes && tagsRes.ok) {
      const tj = await tagsRes.json();
      tags = ((tj as Record<string, unknown>)?.data as Tag[]) || [];
    }
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
      tags,
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
      tags: [] as Tag[],
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
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = formData.get("id") as string;
    const res = await apiFetch(`/api/inspections/${id}`, { token, method: "DELETE" });
    return { ok: res.ok, intent: "delete" };
  }
  if (intent === "archive") {
    const ids = (formData.get("ids") as string).split(",");
    const results = await Promise.all(
      ids.map((id) =>
        apiFetch(`/api/inspections/${id}`, {
          token,
          method: "PATCH",
          body: JSON.stringify({ status: "cancelled" }),
        }),
      ),
    );
    return { ok: results.every((r) => r.ok), intent: "archive" };
  }
  if (intent === "status") {
    const id = formData.get("id") as string;
    const status = formData.get("status") as string;
    const res = await apiFetch(`/api/inspections/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return { ok: res.ok, intent: "status" };
  }
  return { ok: false };
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

const PAGE_SIZE = 25;

export default function DashboardPage() {
  const { buckets, conciergePending, greeting, tags } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  /* ---- State ---- */
  const [activeTab, setActiveTab] = useState<TabKey>(
    (searchParams.get("workflow") as TabKey) || "all",
  );
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [activeTagFilter, setActiveTagFilter] = useState("");
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(searchParams.get("newInspection") === "1" || searchParams.get("new") === "1");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visiblePage, setVisiblePage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /* ---- Columns (persisted in localStorage) ---- */
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS as unknown as string[];
    try {
      const raw = localStorage.getItem("oi.dashboard.columns");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* fallback */ }
    return DEFAULT_COLUMNS as unknown as string[];
  });

  const isColumnVisible = useCallback(
    (id: string) => visibleColumns.includes(id),
    [visibleColumns],
  );

  const toggleColumn = useCallback((id: string) => {
    if (ALWAYS_ON.has(id)) return;
    setVisibleColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      try { localStorage.setItem("oi.dashboard.columns", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const resetColumns = useCallback(() => {
    const def = DEFAULT_COLUMNS as unknown as string[];
    setVisibleColumns(def);
    try { localStorage.setItem("oi.dashboard.columns", JSON.stringify(def)); } catch { /* ignore */ }
  }, []);

  /* ---- Filters modal state ---- */
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAgentId, setFilterAgentId] = useState("");

  /* ---- Dedup'd all inspections ---- */
  const allInspections = useMemo(() => {
    const seen = new Set<string>();
    const out: Inspection[] = [];
    for (const items of Object.values(buckets)) {
      for (const i of items) {
        if (!seen.has(i.id)) { seen.add(i.id); out.push(i); }
      }
    }
    return out;
  }, [buckets]);

  /* ---- Compound filter ---- */
  const filteredInspections = useMemo(() => {
    const now = new Date();
    return allInspections.filter((insp) => {
      // Workflow tab
      if (!matchesWorkflow(insp, activeTab)) return false;
      // Time filter
      if (activeFilter !== "all" && !matchesFilter(insp, activeFilter, now)) return false;
      // Filters modal: date range
      if (filterDateFrom && (!insp.date || insp.date < filterDateFrom)) return false;
      if (filterDateTo && (!insp.date || insp.date > filterDateTo)) return false;
      // Filters modal: agent
      if (filterAgentId && insp.agentId !== filterAgentId) return false;
      // Tag filter
      if (activeTagFilter) {
        const ids = Array.isArray(insp.tagIds) ? insp.tagIds : [];
        if (!ids.includes(activeTagFilter)) return false;
      }
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          insp.address, insp.propertyAddress, insp.clientName, insp.clientEmail, insp.id,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });
  }, [allInspections, activeTab, activeFilter, activeTagFilter, filterDateFrom, filterDateTo, filterAgentId, searchQuery]);

  /* ---- Bucket-mode filtered (for grouped view) ---- */
  const filteredBuckets = useMemo(() => {
    const useFlat = activeFilter !== "all" || searchQuery || activeTagFilter || filterDateFrom || filterDateTo || filterAgentId;
    if (useFlat) return null; // signals flat mode
    const result: Record<string, Inspection[]> = {};
    for (const [key, items] of Object.entries(buckets)) {
      const f = items.filter((i) => matchesWorkflow(i, activeTab));
      if (f.length > 0) result[key] = f;
    }
    return result;
  }, [buckets, activeTab, activeFilter, searchQuery, activeTagFilter, filterDateFrom, filterDateTo, filterAgentId]);

  /* ---- Paginated list for flat mode ---- */
  const paginatedList = useMemo(() => {
    return filteredInspections.slice(0, visiblePage * PAGE_SIZE);
  }, [filteredInspections, visiblePage]);

  const hasMore = paginatedList.length < filteredInspections.length;

  /* ---- Infinite scroll via IntersectionObserver ---- */
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisiblePage((p) => p + 1);
    }, { rootMargin: "200px" });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore]);

  // Reset page when filters change
  useEffect(() => { setVisiblePage(1); }, [activeTab, activeFilter, activeTagFilter, searchQuery, filterDateFrom, filterDateTo, filterAgentId]);

  /* ---- Stats ---- */
  const counts = useMemo(() => ({
    upcoming: new Set([...buckets.today, ...buckets.thisWeek, ...buckets.later].map((i) => i.id)).size,
    inProgress: allInspections.filter((i) => i.status === "in_progress").length,
    needsAttention: buckets.needsAttention.length,
    recent: buckets.recentReports.length,
  }), [buckets, allInspections]);

  /* ---- Filter counts for the time-filter strip ---- */
  const filterCounts = useMemo(() => {
    const now = new Date();
    const out: Record<string, number> = { all: allInspections.length };
    for (const f of INSPECTION_FILTERS) {
      if (f.id === "all") continue;
      out[f.id] = allInspections.filter((i) => matchesFilter(i, f.id, now)).length;
    }
    return out;
  }, [allInspections]);

  /* ---- Tab counts for workflow tabs ---- */
  const tabCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of TABS) {
      out[t.key] = allInspections.filter((i) => matchesWorkflow(i, t.key)).length;
    }
    return out;
  }, [allInspections]);

  /* ---- Bucket toggle ---- */
  const toggleBucket = (key: string) =>
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  /* ---- Batch select ---- */
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => {
    const ids = filteredInspections.map((i) => i.id);
    setSelectedIds(new Set(ids));
  };

  const clearSelection = () => setSelectedIds(new Set());

  /* ---- Batch actions ---- */
  const batchArchive = () => {
    if (selectedIds.size === 0) return;
    fetcher.submit(
      { intent: "archive", ids: [...selectedIds].join(",") },
      { method: "post" },
    );
    clearSelection();
  };

  const batchDelete = () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      fetcher.submit({ intent: "delete", id }, { method: "post" });
    }
    clearSelection();
  };

  /* ---- CSV export ---- */
  const exportCsv = useCallback(() => {
    const rows = filteredInspections;
    if (rows.length === 0) return;
    const header = ["ID", "Address", "Client", "Date", "Status", "Payment", "Agent", "Price"];
    const csvRows = [
      header.join(","),
      ...rows.map((i) =>
        [
          i.id,
          `"${(i.address || i.propertyAddress || "").replace(/"/g, '""')}"`,
          `"${(i.clientName || "").replace(/"/g, '""')}"`,
          i.date || "",
          i.status,
          i.paymentStatus || "",
          `"${(i.agentName || "").replace(/"/g, '""')}"`,
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
  }, [filteredInspections]);

  /* ---- Status transition ---- */
  const transitionStatus = (id: string, status: string) => {
    fetcher.submit({ intent: "status", id, status }, { method: "post" });
  };

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

  const totalFiltered = filteredBuckets
    ? Object.values(filteredBuckets).flat().length
    : filteredInspections.length;

  /* ---- Render inspection row ---- */
  function InspectionRow({ insp }: { insp: Inspection }) {
    const isSelected = selectedIds.has(insp.id);
    return (
      <div className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelect(insp.id)}
          className="accent-indigo-600 shrink-0"
        />
        <Link
          to={`/inspections/${insp.id}/edit`}
          className="flex items-center justify-between flex-1 min-w-0"
        >
          <div className="min-w-0">
            {isColumnVisible("propertyAddress") && (
              <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
                {insp.address || insp.propertyAddress || "No address"}
              </p>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {isColumnVisible("clientName") && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {insp.clientName || "No client"}
                </span>
              )}
              {isColumnVisible("date") && insp.date && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  &middot; {insp.date}
                </span>
              )}
              {isColumnVisible("agent") && insp.agentName && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  &middot; {insp.agentName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {isColumnVisible("statusIcons") && (
              <StatusChip status={insp.status} />
            )}
            {isColumnVisible("defectChips") && insp.defectStats && (
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
            {isColumnVisible("price") && insp.price != null && (
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                ${insp.price}
              </span>
            )}
          </div>
        </Link>
        {/* Status transition dropdown (visible on hover) */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <select
            value={insp.status}
            onChange={(e) => transitionStatus(insp.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="h-6 px-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 border-0 outline-none cursor-pointer"
          >
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_progress">In Progress</option>
            <option value="delivered">Delivered</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
    );
  }

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
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="h-8 w-40 pl-8 pr-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-[13px] text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none placeholder:text-slate-400"
            />
            <SearchSmIcon />
          </div>
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
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
              activeTab === tab.key
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${
              activeTab === tab.key
                ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
              {tabCounts[tab.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Time filter strip */}
      <div className="flex items-center gap-1 flex-wrap">
        {INSPECTION_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
              activeFilter === f.id
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            {f.label}
            <span className="ml-1 opacity-70">{filterCounts[f.id] ?? 0}</span>
          </button>
        ))}
        {/* Tag filter */}
        {tags.length > 0 && (
          <select
            value={activeTagFilter}
            onChange={(e) => setActiveTagFilter(e.target.value)}
            className="h-7 px-2 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 border-0 outline-none ml-2"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Batch actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
          <span className="text-[13px] font-bold text-indigo-600 dark:text-indigo-400">
            {selectedIds.size} selected
          </span>
          <button onClick={batchArchive} className="text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-colors">
            Archive
          </button>
          <button onClick={batchDelete} className="text-[12px] font-bold text-red-500 hover:text-red-600 transition-colors">
            Delete
          </button>
          <button onClick={selectAll} className="text-[12px] font-bold text-slate-500 hover:text-slate-700 transition-colors ml-auto">
            Select all
          </button>
          <button onClick={clearSelection} className="text-[12px] font-bold text-slate-500 hover:text-slate-700 transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* Inspection list */}
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
      ) : filteredBuckets ? (
        /* Grouped bucket view */
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
                      <InspectionRow key={insp.id} insp={insp} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat filtered view */
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700">
            <span className="text-[11px] font-bold text-slate-400">
              {filteredInspections.length} result{filteredInspections.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {paginatedList.map((insp) => (
              <InspectionRow key={insp.id} insp={insp} />
            ))}
          </div>
          {/* Infinite scroll sentinel */}
          {hasMore && <div ref={sentinelRef} className="h-8" />}
        </div>
      )}

      {/* Wizard modal */}
      <NewInspectionWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* Command Palette */}
      <CommandPalette onNewInspection={() => setWizardOpen(true)} />

      {/* Filters modal */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setFiltersOpen(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">Filters</h2>
              <button onClick={() => setFiltersOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg">&times;</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-slate-500 mb-1">Date from</label>
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] outline-none" />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-500 mb-1">Date to</label>
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] outline-none" />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-500 mb-1">Agent ID</label>
                <input type="text" value={filterAgentId} onChange={(e) => setFilterAgentId(e.target.value)} placeholder="Agent ID" className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] outline-none" />
              </div>
            </div>
            <div className="flex items-center justify-between mt-6">
              <button onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); setFilterAgentId(""); }} className="text-[12px] font-bold text-slate-500 hover:text-slate-700">
                Reset
              </button>
              <button onClick={() => setFiltersOpen(false)} className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Columns modal */}
      {columnsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setColumnsOpen(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">Customize Columns</h2>
              <button onClick={() => setColumnsOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg">&times;</button>
            </div>
            <div className="space-y-2">
              {COLUMN_REGISTRY.map((col) => (
                <label key={col.id} className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isColumnVisible(col.id)}
                    disabled={ALWAYS_ON.has(col.id)}
                    onChange={() => toggleColumn(col.id)}
                    className="accent-indigo-600"
                  />
                  <span className="text-[13px] text-slate-700 dark:text-slate-300">
                    {col.label}
                    {ALWAYS_ON.has(col.id) && <span className="ml-1 text-[10px] text-slate-400">(required)</span>}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between mt-6">
              <button onClick={resetColumns} className="text-[12px] font-bold text-slate-500 hover:text-slate-700">
                Reset to defaults
              </button>
              <button onClick={() => setColumnsOpen(false)} className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small components                                                   */
/* ------------------------------------------------------------------ */

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
    scheduled: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    confirmed: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
    in_progress: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
    delivered: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    published: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    cancelled: "bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400",
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

function SearchSmIcon() {
  return (
    <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

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
