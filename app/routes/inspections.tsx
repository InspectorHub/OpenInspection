import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useLoaderData, useFetcher, useSearchParams, useNavigate, redirect } from "react-router";
import type { InspectionSearchItem } from "~/routes/resources/inspection-search";
import type { Route } from "./+types/inspections";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { buildCreateInspectionJson } from "~/lib/inspection-create";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";
import { searchContactsForTypeahead } from "~/lib/contact-search.server";
import type { WizardTeamMember } from "~/components/NewInspectionWizard";
import { OnboardingChecklist } from "~/components/dashboard/OnboardingChecklist";
import { SeatBanner } from "~/components/SeatBanner";
import { QuotaBanner } from "~/components/QuotaBanner";
import { useSessionContext, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { computeOnboardingSteps } from "~/lib/onboarding-progress";
import { getScheduleSet } from "~/lib/schedule-onboarding.server";
import { INSPECTION_STATUS, isReportPublished } from "~/lib/status";
import { PageHeader, TabStrip, Pill, Card, Button, Icon } from "@core/shared-ui";
import {
  DEFAULT_COLUMNS,
  ALWAYS_ON,
  INSPECTION_FILTERS,
  TABS,
  BUCKET_META,
  PAGE_SIZE,
  type Inspection,
  type Tag,
  type TemplateOption,
  type ServiceOption,
  type DashboardData,
  type FilterId,
  type TabKey,
} from "~/lib/dashboard-schema";
import { matchesFilter, matchesWorkflow, tabMatches } from "~/lib/dashboard-filters";
import { dedupeBucketMembership, emptyDashboard } from "~/lib/dashboard-buckets";
import { DashboardInspectionRow } from "~/components/dashboard/DashboardInspectionRow";
import { FiltersDrawer } from "~/components/dashboard/FiltersDrawer";
import { ColumnsPopover } from "~/components/dashboard/ColumnsPopover";
import { InspectionsToolbar } from "~/components/dashboard/InspectionsToolbar";
import { InspectionsFilterStrip } from "~/components/dashboard/InspectionsFilterStrip";
import { InspectionsEmptyState } from "~/components/dashboard/InspectionsEmptyState";
import { InspectionsStatCards } from "~/components/dashboard/InspectionsStatCards";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";

// Re-exported for unit tests (tests/web import these from ~/routes/inspections).
export { tabMatches, matchesWorkflow };

export function meta() {
  return [{ title: m.inspections_list_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    // Templates + services power the New Inspection wizard (B-6 picker + B-8
    // service linking). They are best-effort: a failure must not break the
    // dashboard, so each falls back to an empty list.
    // meRes: best-effort fetch for onboardingState.checklistDismissed (IA-12).
    // The TODO(C-10) cast mirrors settings-account.tsx — hono/client collapses
    // the typed union; assertion is localized here and does not affect safety.
    const meGet = api.auth.me.$get as unknown as (args?: unknown) => Promise<Response>;
    const [dashRes, tagsRes, templatesRes, servicesRes, meRes, membersRes, usageRes, scheduleSet] = await Promise.all([
      api.inspections.dashboard.$get(),
      api.tags.index.$get().catch(() => null),
      api.inspections.templates.$get({ query: { page: "1", pageSize: "100" } }).catch(() => null),
      api.services.index.$get().catch(() => null),
      meGet().catch(() => null),
      api.admin.members.$get().catch(() => null),
      // Free-tier quota banner — best-effort, same pattern as the other
      // Promise.all entries above. `caps` comes back null for non-free
      // tenants and for standalone deploys, so QuotaBanner renders nothing.
      api.usage.summary.$get().catch(() => null),
      getScheduleSet(api),
    ]);
    const json = dashRes.ok ? ((await dashRes.json()) as Record<string, unknown>) : {};
    const d = (json.data ?? {}) as unknown as DashboardData | undefined;
    let tags: Tag[] = [];
    if (tagsRes && tagsRes.ok) {
      const tj = (await tagsRes.json()) as Record<string, unknown>;
      tags = (tj.data ?? []) as Tag[];
    }
    let templates: TemplateOption[] = [];
    if (templatesRes && templatesRes.ok) {
      const tj = (await templatesRes.json()) as { data?: TemplateOption[] };
      templates = (tj.data ?? []).map((t) => ({ id: t.id, name: t.name, itemCount: t.itemCount }));
    }
    let svcOptions: ServiceOption[] = [];
    if (servicesRes && servicesRes.ok) {
      const sj = (await servicesRes.json()) as { data?: ServiceOption[] };
      svcOptions = (sj.data ?? []).map((s) => ({ id: s.id, name: s.name, price: s.price }));
    }
    // B-21 team step — non-admins get 403 → null → []; team step hidden for them.
    const schedulingRoles = new Set(["owner", "manager", "inspector"]);
    let teamMembers: WizardTeamMember[] = [];
    if (membersRes?.ok) {
      const mb = (await membersRes.json()) as { data?: Array<{ id: string; email: string; role: string; name?: string | null }> };
      teamMembers = (mb.data ?? [])
        .filter((m) => schedulingRoles.has(m.role))
        .map((m) => ({ id: m.id, name: m.name ?? m.email }));
    }
    // IA-12: read checklistDismissed from onboardingState. Best-effort: if the
    // call fails we show the checklist (safe default — the user can dismiss again).
    let checklistDismissed = false;
    if (meRes && meRes.ok) {
      const meBody = (await meRes.json().catch(() => ({}))) as {
        data?: { user?: { onboardingState?: Record<string, boolean> | null } };
      };
      checklistDismissed = meBody.data?.user?.onboardingState?.checklistDismissed === true;
    }
    let quotaCaps: { inspections: number; sms: number; email: number } | null = null;
    let quotaUsage: { inspections: number; sms: number; email: number } | null = null;
    if (usageRes && usageRes.ok) {
      const ub = (await usageRes.json().catch(() => ({}))) as {
        data?: {
          caps?: { inspections: number; sms: number; email: number } | null;
          usage?: { inspections?: number; sms?: number; email?: number };
        };
      };
      quotaCaps = ub.data?.caps ?? null;
      if (quotaCaps) {
        quotaUsage = {
          inspections: ub.data?.usage?.inspections ?? 0,
          sms: ub.data?.usage?.sms ?? 0,
          email: ub.data?.usage?.email ?? 0,
        };
      }
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
      greeting: m.inspections_list_greeting_morning(),
      tags,
      templates,
      services: svcOptions,
      teamMembers,
      checklistDismissed,
      // Raw counts/flags for the onboarding checklist.
      templateCount: templates.length,
      serviceCount: svcOptions.length,
      scheduleSet,
      quotaCaps,
      quotaUsage,
      loadFailed: false,
    };
  } catch {
    return emptyDashboard(true);
  }
}

function getGreeting() {
  if (typeof window === "undefined") return m.inspections_list_greeting_morning();
  const h = new Date().getHours();
  if (h < 12) return m.inspections_list_greeting_morning();
  if (h < 17) return m.inspections_list_greeting_afternoon();
  return m.inspections_list_greeting_evening();
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const api = createApi(context, { token });
  if (intent === "create") {
    // The New Inspection wizard posts here with intent:"create". Map its
    // fields to the create endpoint and bounce into the new inspection's
    // editor on success (which also refreshes the dashboard list — B-8).
    //
    // portal #105 — the wizard's idempotency key arrives as a FORM FIELD
    // (`fetcher.submit()` takes no headers and this is a BFF, so the browser
    // never talks to /api directly), while the server middleware keys off the
    // `Idempotency-Key` HEADER. This lift is the only thing joining the two:
    // without it the wizard mints a key nothing reads and a double submit
    // creates two inspections. The field is NOT forwarded in the JSON —
    // `buildCreateInspectionJson` builds an explicit whitelist, so the key
    // never reaches the created record.
    const idempotencyKey = String(formData.get(IDEMPOTENCY_FIELD) || "").trim();
    const res = await api.inspections.index.$post(
      { json: buildCreateInspectionJson(formData) },
      idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : undefined,
    );
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { data?: { inspection?: { id?: string } } };
      const id = body?.data?.inspection?.id;
      if (id) return redirect(`/inspections/${id}/edit`);
    }
    // Surface the API rejection in the worker log — silent { ok:false }
    // responses have repeatedly cost full debugging rounds (see save-settings).
    // Also propagate the structured error (code + details) so the wizard can
    // branch on QUOTA_EXHAUSTED (402) and show the upgrade panel instead of
    // silently closing — see NewInspectionWizard's post-submit effect.
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; details?: { billingPortalUrl?: string | null } };
    };
    console.error("[create] POST /api/inspections failed", res.status, errBody);
    return { ok: false, intent: "create", error: errBody.error };
  }
  // People-step typeaheads (BFF pattern — no client-side fetch, C-12 rule).
  // Agents have searched Contacts since IA-1; Batch D gives the client the same
  // search, because a repeat client had to be re-typed by hand — name, email and
  // phone — beside a table that already held all three. The create endpoint
  // deduplicates the contact by email, which is why the email comes back too.
  if (intent === "search-agents") {
    const search = String(formData.get("search") || "").trim();
    return { intent: "search-agents" as const, agents: await searchContactsForTypeahead(api, "agent", search) };
  }
  if (intent === "search-clients") {
    const search = String(formData.get("search") || "").trim();
    return { intent: "search-clients" as const, clients: await searchContactsForTypeahead(api, "client", search) };
  }
  if (intent === "dismiss-checklist") {
    // IA-12: write checklistDismissed: true into onboardingState.
    // Mirrors the skipSetupRoute pattern in auth.ts (same table/field shape).
    // TODO(C-10): same hono/client collapse as auth.me — localized cast.
    const dismissPost = api.auth.checklist.dismiss.$post as unknown as (args?: unknown) => Promise<Response>;
    const res = await dismissPost().catch(() => null);
    return { ok: res?.ok ?? false, intent: "dismiss-checklist" as const };
  }
  if (intent === "delete") {
    const id = formData.get("id") as string;
    const res = await api.inspections[":id"].$delete({ param: { id } });
    return { ok: res.ok, intent: "delete" };
  }
  if (intent === "status") {
    const id = formData.get("id") as string;
    const status = formData.get("status") as "requested" | "scheduled" | "confirmed" | "completed" | "cancelled";
    const res = await api.inspections[":id"].$patch({
      param: { id },
      json: { status },
    });
    return { ok: res.ok, intent: "status" };
  }
  return { ok: false };
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function InspectionsPage() {
  const { buckets, conciergePending, greeting: _ssrGreeting, tags, checklistDismissed: loaderDismissed, templateCount, serviceCount, scheduleSet, quotaCaps, quotaUsage, loadFailed } = useLoaderData<typeof loader>();
  const sessionCtx = useSessionContext();
  // Scheduled times render in the viewer's effective zone, resolved once here
  // rather than per row (and never left to the browser — see format-date).
  const displayTz = useDisplayTimeZone();
  const [greeting, setGreeting] = useState(_ssrGreeting);
  useEffect(() => { setGreeting(getGreeting()); }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  /* ---- IA-12 Onboarding checklist ---- */
  // Optimistic dismiss: hide immediately on click, persist via BFF.
  const [checklistDismissedOptimistic, setChecklistDismissedOptimistic] = useState(false);
  const dismissFetcher = useFetcher();
  const checklistDismissed = loaderDismissed || checklistDismissedOptimistic;

  /* ---- State ---- */
  // Workflow tab is derived from the URL (two-way sync — mirrors usePagination).
  // Unknown/absent ?workflow values fall back to "all" rather than crashing, so
  // the sidebar can deep-link a tab (#111) and refresh/back preserve it.
  const rawWorkflow = searchParams.get("workflow");
  const activeTab: TabKey = TABS.some((t) => t.key === rawWorkflow)
    ? (rawWorkflow as TabKey)
    : "all";
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [activeTagFilter, setActiveTagFilter] = useState("");
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsBtnRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visiblePage, setVisiblePage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /* ---- Server-side search (fetcher + state) ---- */
  const searchFetcher = useFetcher<{ inspections: InspectionSearchItem[]; hasMore: boolean; nextCursor: string | null }>();
  const [serverResults, setServerResults] = useState<InspectionSearchItem[]>([]);
  const [serverCursor, setServerCursor] = useState<string | null>(null);
  const [serverHasMore, setServerHasMore] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadMoreRef = useRef(false);

  /* ---- Columns (persisted in localStorage) ---- */
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS;
    try {
      const raw = localStorage.getItem("oi.dashboard.columns");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* fallback */ }
    return DEFAULT_COLUMNS;
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
    const def = DEFAULT_COLUMNS;
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
    // The payload's buckets overlap on purpose — the stat cards read them as
    // separate lenses — but the list showed one inspection as two rows.
    return dedupeBucketMembership(result);
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

  // Debounce searchQuery → server-side search via BFF
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim()) {
      setServerResults([]);
      setServerCursor(null);
      setServerHasMore(false);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      isLoadMoreRef.current = false;
      setServerResults([]);
      setServerCursor(null);
      searchFetcher.load(`/resources/inspection-search?q=${encodeURIComponent(searchQuery.trim())}`);
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]); // searchFetcher.load is stable; omitting it avoids infinite loop

  // Apply searchFetcher results (fresh search or load-more append)
  useEffect(() => {
    if (searchFetcher.state !== "idle" || !searchFetcher.data) return;
    const d = searchFetcher.data;
    if (isLoadMoreRef.current) {
      setServerResults(prev => [...prev, ...d.inspections]);
      isLoadMoreRef.current = false;
    } else {
      setServerResults(d.inspections);
    }
    setServerHasMore(d.hasMore ?? false);
    setServerCursor(d.nextCursor ?? null);
  }, [searchFetcher.state, searchFetcher.data]);

  /* ---- IA-12: Onboarding steps ---- */
  // Session branding falls back to OpenInspection until the company sets a name.
  const onboardingSteps = useMemo(() => {
    const companyName = sessionCtx?.branding?.companyName ?? 'OpenInspection';
    const companyNameSet = companyName !== 'OpenInspection';
    // A non-UTC tenant timezone means the workspace has configured it (option A).
    const timezoneSet = (sessionCtx?.branding?.defaultTimezone ?? 'UTC') !== 'UTC';
    const inspectionCount = allInspections.length;
    return computeOnboardingSteps({
      companyNameSet,
      timezoneSet,
      templateCount,
      serviceCount,
      inspectionCount,
      scheduleSet,
    });
  }, [sessionCtx, templateCount, serviceCount, scheduleSet, allInspections]);

  /* ---- Stats ---- */
  const counts = useMemo(() => ({
    upcoming: new Set([...buckets.today, ...buckets.thisWeek, ...buckets.later].map((i) => i.id)).size,
    inProgress: allInspections.filter((i) => i.status === INSPECTION_STATUS.COMPLETED && !isReportPublished(i.reportStatus)).length,
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
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  /* ---- Batch select ---- */
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const selectAll = () => {
    const ids = filteredInspections.map((i) => i.id);
    setSelectedIds(new Set(ids));
  };

  const clearSelection = () => setSelectedIds(new Set());

  /* ---- Batch actions ---- */
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
    // `price` is integer cents (the P-4 chain, resolved server-side — IA-131).
    // The column is named for the unit rather than converted, so a spreadsheet
    // never has to guess which one it got.
    const header = ["ID", "Address", "Client", "Date", "Status", "Payment", "Agent", "Price (cents)"];
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

  /* ---- Server search load-more ---- */
  const handleSearchLoadMore = () => {
    if (!serverHasMore || !serverCursor || !searchQuery.trim()) return;
    isLoadMoreRef.current = true;
    searchFetcher.load(`/resources/inspection-search?q=${encodeURIComponent(searchQuery.trim())}&cursor=${encodeURIComponent(serverCursor)}`);
  };

  /* ---- Status transition ---- */
  const transitionStatus = (id: string, status: string) => {
    fetcher.submit({ intent: "status", id, status }, { method: "post" });
  };

  const totalFiltered = filteredBuckets
    ? Object.values(filteredBuckets).flat().length
    : filteredInspections.length;

  // Everything that can narrow the list — read by the empty state to tell
  // "nothing here" from "nothing matching", and cleared as a set below.
  const listFilterState = {
    tab: activeTab,
    timeFilter: activeFilter,
    tagId: activeTagFilter,
    dateFrom: filterDateFrom,
    dateTo: filterDateTo,
    agentId: filterAgentId,
    search: searchQuery,
  };

  // The workflow tab lives in the URL, not in state — one writer for it, used by
  // the tab strip and by "Clear filters".
  //   replace:true so tab flips don't pollute browser history;
  //   preventScrollReset keeps the list scroll position on switch.
  function setWorkflowTab(id: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === "all") next.delete("workflow");
      else next.set("workflow", id);
      return next;
    }, { replace: true, preventScrollReset: true });
  }

  function clearAllFilters() {
    setActiveFilter("all");
    setActiveTagFilter("");
    setSearchQuery("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterAgentId("");
    setWorkflowTab("all");
  }

  // #111: tenant slug for the public report deep-link (Published tab). Available
  // from the auth-layout session context the dashboard already consumes.
  const tenantSlug = sessionCtx?.branding?.tenantSlug ?? null;

  // Portal billing deep-link — consumed by the SeatBanner and free-tier
  // QuotaBanner below. Undefined when no portal base URL is configured.
  const billingUrl = sessionCtx?.branding?.portalBaseUrl ? `${sessionCtx.branding.portalBaseUrl}/billing` : undefined;

  // A row's props are identical in both the grouped and flat views; this keeps
  // the two render sites in sync.
  const renderRow = (insp: Inspection) => (
    <DashboardInspectionRow
      key={insp.id}
      insp={insp}
      reportView={activeTab === "published" || activeTab === "to_review"}
      tenantSlug={tenantSlug}
      selectedIds={selectedIds}
      isColumnVisible={isColumnVisible}
      toggleSelect={toggleSelect}
      transitionStatus={transitionStatus}
      timeZone={displayTz}
    />
  );

  return (
    /* ds-allow: page bottom gutter (60px), bespoke page-shell spacing with no token */
    <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9 space-y-ih-list">
      {/* IA-118 — an empty dashboard is this page's strongest claim: it says the
          operator has no work. Do not make it because a request failed. */}
      {loadFailed && <LoadFailedNotice />}
      {/* F3 — Seat quota banner */}
      {sessionCtx?.seatUsage && (
        <SeatBanner usage={sessionCtx.seatUsage} billingUrl={billingUrl} />
      )}

      {/* Free-tier usage quota banners — one per capped metric, each hides
          itself below 80% usage (see QuotaBanner). */}
      {quotaCaps && quotaUsage && (
        <>
          {(["inspections", "sms", "email"] as const).map((metric) => (
            <QuotaBanner
              key={metric}
              metric={metric}
              used={quotaUsage[metric]}
              cap={quotaCaps[metric]}
              billingUrl={billingUrl}
            />
          ))}
        </>
      )}

      {/* PageHeader */}
      <PageHeader
        title={greeting}
        meta={
          <>
            {counts.upcoming === 1
              ? m.inspections_list_meta_upcoming_one({ count: counts.upcoming })
              : m.inspections_list_meta_upcoming_other({ count: counts.upcoming })}
            {counts.needsAttention > 0 && (
              <span>
                {" "}&middot;{" "}
                {counts.needsAttention === 1
                  ? m.inspections_list_meta_needs_one({ count: counts.needsAttention })
                  : m.inspections_list_meta_needs_other({ count: counts.needsAttention })}
              </span>
            )}
            {conciergePending > 0 && (
              <span>
                {" "}&middot;{" "}
                {conciergePending === 1
                  ? m.inspections_list_meta_pending_one({ count: conciergePending })
                  : m.inspections_list_meta_pending_other({ count: conciergePending })}
              </span>
            )}
          </>
        }
        actions={
          <>
            {/* Page-level actions only. List controls (search / filters /
                columns) live in the table toolbar strip below — DS two-layer
                actions convention. */}
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              {m.inspections_list_action_export()}
            </Button>
            <Button variant="primary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => navigate("/inspections/new")}>
              {m.inspections_list_action_new()}
            </Button>
          </>
        }
      />

      {/* Stat cards — quick-jump to buckets */}
      <InspectionsStatCards counts={counts} />

      {/* IA-12 — Onboarding checklist (hidden when dismissed or allDone) */}
      <OnboardingChecklist
        steps={onboardingSteps}
        dismissed={checklistDismissed}
        onDismiss={() => {
          setChecklistDismissedOptimistic(true);
          dismissFetcher.submit(
            { intent: "dismiss-checklist" },
            { method: "post" },
          );
        }}
        onOpenWizard={() => navigate("/inspections/new")}
      />

      {/* Workflow tabs */}
      <TabStrip
        tabs={TABS.map((t) => ({ id: t.key, label: t.label, count: t.key === "all" ? undefined : (tabCounts[t.key] ?? 0) }))}
        activeId={activeTab}
        onChange={setWorkflowTab}
      />

      <InspectionsFilterStrip
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        filterCounts={filterCounts}
        tags={tags}
        activeTagFilter={activeTagFilter}
        setActiveTagFilter={setActiveTagFilter}
      />

      {/* Table toolbar strip — list controls (search + filters + columns).
          Split out of the page header per the DS two-layer actions convention.
          columnsBtnRef is forwarded through so the ColumnsPopover stays anchored
          to the relocated Columns button. */}
      <InspectionsToolbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenFilters={() => setFiltersOpen(true)}
        onToggleColumns={() => setColumnsOpen((v) => !v)}
        columnsBtnRef={columnsBtnRef}
      />

      {/* Batch actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-ih-primary-tint rounded-lg border border-ih-border">
          <span className="text-[13px] font-bold text-ih-primary">
            {m.inspections_list_batch_selected({ count: selectedIds.size })}
          </span>
          <Button variant="danger" size="sm" onClick={batchDelete}>{m.common_delete()}</Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={selectAll}>{m.inspections_list_batch_select_all()}</Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>{m.common_clear()}</Button>
        </div>
      )}

      {/* Inspection list. An empty list has two causes and they need opposite
          remedies: a workspace with nothing in it wants a way to create the
          first inspection, and a list emptied by filters wants those filters
          gone. It used to say the first thing in both cases — telling a
          workspace with two hundred inspections that it had none — and to point
          at a button ("+ New Inspection") that does not exist under that name,
          instead of containing one. */}
      {totalFiltered === 0 ? (
        <Card>
          <InspectionsEmptyState
            totalAll={allInspections.length}
            filters={listFilterState}
            onClearFilters={clearAllFilters}
            onCreate={() => navigate("/inspections/new")}
          />
        </Card>
      ) : filteredBuckets ? (
        /* Grouped bucket view */
        <div className="space-y-3">
          {Object.entries(filteredBuckets).map(([key, items]) => {
            if (items.length === 0) return null;
            const meta = BUCKET_META[key] ?? { label: key, hint: "" };
            const collapsed = collapsedBuckets.has(key);
            return (
              <Card key={key} className="overflow-hidden">
                <button
                  onClick={() => toggleBucket(key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-ih-bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4">
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-ih-fg-4">
                      {meta.hint}
                    </span>
                    <Pill tone="gen">{items.length}</Pill>
                  </div>
                  <Icon
                    name="chevD"
                    size={16}
                    className={`text-ih-fg-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
                  />
                </button>
                {!collapsed && (
                  <div className="divide-y divide-ih-border">
                    {items.map(renderRow)}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        /* Flat filtered view — server search when query active, client-side otherwise */
        (() => {
          const isServerSearch = searchQuery.trim().length > 0;
          const isSearching = isServerSearch && searchFetcher.state !== "idle";
          const displayList = isServerSearch ? (serverResults as unknown as Inspection[]) : paginatedList;
          const displayCount = isServerSearch ? serverResults.length : filteredInspections.length;
          return (
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-ih-border">
                <span className="text-[11px] font-bold text-ih-fg-4">
                  {isSearching
                    ? m.inspections_list_searching()
                    : displayCount === 1
                      ? m.inspections_list_results_one({ count: displayCount })
                      : m.inspections_list_results_other({ count: displayCount })}
                </span>
              </div>
              <div className="divide-y divide-ih-border">
                {!isSearching && displayList.map(renderRow)}
              </div>
              {isSearching && (
                <div className="py-8 text-center text-[12px] text-ih-fg-4">{m.inspections_list_searching()}</div>
              )}
              {/* Server search load-more */}
              {isServerSearch && serverHasMore && !isSearching && (
                <div className="p-3 border-t border-ih-border text-center">
                  <button
                    onClick={handleSearchLoadMore}
                    className="h-8 px-4 rounded-md text-[12px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
                  >
                    {m.inspections_list_load_more()}
                  </button>
                </div>
              )}
              {/* Infinite scroll for non-search flat mode */}
              {!isServerSearch && hasMore && <div ref={sentinelRef} className="h-8" />}
            </Card>
          );
        })()
      )}

      {/* Command Palette is mounted once at auth-layout (IA-49) so Cmd/Ctrl+K
          works workspace-wide, not only on this page. */}

      {/* Filters drawer */}
      <FiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filterDateFrom={filterDateFrom}
        filterDateTo={filterDateTo}
        filterAgentId={filterAgentId}
        setFilterDateFrom={setFilterDateFrom}
        setFilterDateTo={setFilterDateTo}
        setFilterAgentId={setFilterAgentId}
      />

      {/* Columns popover — anchored to the toolbar "Columns" button */}
      <ColumnsPopover open={columnsOpen} onClose={() => setColumnsOpen(false)} anchorRef={columnsBtnRef}
        isColumnVisible={isColumnVisible} toggleColumn={toggleColumn} resetColumns={resetColumns} />
    </div>
  );
}

