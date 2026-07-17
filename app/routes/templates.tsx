import { useState, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/templates";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { Pagination, PageHeader, Icon } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { usePagination } from "~/hooks/usePagination";
import { type SortKey, type Template } from "~/components/templates/types";
import { TemplatesListView } from "~/components/templates/TemplatesListView";
import { TemplatesCardView } from "~/components/templates/TemplatesCardView";
import { CreateTemplateModal } from "~/components/templates/CreateTemplateModal";
import { ImportSpectoraModal } from "~/components/templates/ImportSpectoraModal";
import { DeleteTemplateModal } from "~/components/templates/DeleteTemplateModal";
import { SpectoraMappingModal } from "~/components/templates/SpectoraMappingModal";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.templates_list_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const url = new URL(request.url);
    const page     = url.searchParams.get("page")     ?? "1";
    const pageSize = url.searchParams.get("pageSize") ?? "50";
    const q        = url.searchParams.get("q")        ?? "";
    const api = createApi(context, { token });
    // Best-effort /api/auth/me to read spectoraMappingSeen (same pattern as dashboard IA-12).
    // TODO(C-10): same hono/client collapse as auth.me — localized cast.
    const meGet = api.auth.me.$get as unknown as (args?: unknown) => Promise<Response>;
    const [res, meRes] = await Promise.all([
      api.inspections.templates.$get({ query: { page, pageSize, ...(q ? { q } : {}) } }),
      meGet().catch(() => null),
    ]);
    const body = res.ok
      ? ((await res.json()) as { data?: unknown[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } })
      : { data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } };
    const templates = (body.data ?? []) as Template[];
    const meta = body.meta ?? { total: 0, page: 1, pageSize: 50, totalPages: 1 };
    let spectoraMappingSeen = false;
    if (meRes && meRes.ok) {
      const meBody = (await meRes.json().catch(() => ({}))) as {
        data?: { user?: { onboardingState?: Record<string, boolean> | null } };
      };
      spectoraMappingSeen = meBody.data?.user?.onboardingState?.spectoraMappingSeen === true;
    }
    return { templates, meta, q, token, spectoraMappingSeen };
  } catch {
    return {
      templates: [] as Template[],
      meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      q: "",
      token: "",
      spectoraMappingSeen: false,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

// Dig the created template's id out of the `{ data: { template: { id } } }`
// envelope these endpoints return; null when any layer is missing.
function extractTemplateId(result: unknown): string | null {
  const data = (result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const template = data?.template as Record<string, unknown> | undefined;
  const id = template?.id;
  return typeof id === "string" ? id : null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const api = createApi(context, { token });

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: m.templates_create_error_name_required() };
    const res = await api.inspections.templates.$post({
      json: { name, schema: { schemaVersion: 2, sections: [] } },
    });
    if (res.ok) {
      return { ok: true, newId: extractTemplateId(await res.json()) };
    }
    const err = await res.json().catch(() => ({}));
    return { error: (err as Record<string, unknown>)?.message || m.templates_create_error_failed() };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    const res = await api.inspections.templates[":id"].$delete({ param: { id } });
    return { ok: res.ok, intent: "delete" };
  }

  if (intent === "duplicate") {
    const name = formData.get("name") as string;
    const schema = formData.get("schema") as string;
    const res = await api.inspections.templates.$post({
      json: {
        name: m.templates_duplicate_copy_suffix({ name }),
        schema: schema ? JSON.parse(schema) : { schemaVersion: 2, sections: [] },
      },
    });
    if (res.ok) {
      return { ok: true, newId: extractTemplateId(await res.json()), intent: "duplicate" };
    }
    return { error: m.templates_duplicate_error_failed(), intent: "duplicate" };
  }

  if (intent === "import-spectora") {
    const name = (formData.get("name") as string)?.trim();
    const payload = (formData.get("payload") as string)?.trim();
    if (!name || !payload) return { error: m.templates_import_error_name_json_required() };
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { return { error: m.templates_import_error_invalid_json() }; }
    const res = await api.inspections.templates["import-spectora"].$post({
      json: { name, spectora: parsed as Record<string, unknown> },
    });
    if (res.ok) {
      const result = await res.json();
      const d = (result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const stats = d?.stats as Record<string, unknown> | undefined;
      return { ok: true, newId: extractTemplateId(result), stats, intent: "import-spectora" };
    }
    const err = await res.json().catch(() => ({}));
    return { error: (err as Record<string, unknown>)?.message || m.templates_import_error_failed() };
  }

  if (intent === "mark-spectora-mapping-seen") {
    // Persist spectoraMappingSeen flag via the generic onboarding-flag endpoint.
    // TODO(C-10): same hono/client collapse as dashboard dismiss — localized cast.
    const flagPost = api.auth.onboarding.flag.$post as unknown as (args?: unknown) => Promise<Response>;
    await flagPost({ json: { flag: "spectoraMappingSeen" } }).catch(() => null);
    return { ok: true, intent: "mark-spectora-mapping-seen" as const };
  }

  return { ok: false };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TemplatesPage() {
  const { templates, meta, q: loaderQ, spectoraMappingSeen: loaderMappingSeen } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const mappingFetcher = useFetcher();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setPage, setPageSize } = usePagination();

  const [view, setView] = useState<"list" | "card">("list");
  const [searchQuery, setSearchQuery] = useState(loaderQ);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [importName, setImportName] = useState("");
  const [importPayload, setImportPayload] = useState("");
  // Concept-mapping modal: shown once after a successful Spectora import.
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  // Optimistic seen state — hide immediately once the user clicks "Got it".
  const [mappingSeenOptimistic, setMappingSeenOptimistic] = useState(false);
  const spectoraMappingSeen = loaderMappingSeen || mappingSeenOptimistic;

  // Debounced URL-based search: triggers loader re-run for server-side filtering
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (searchQuery) {
        params.set("q", searchQuery);
      } else {
        params.delete("q");
      }
      params.delete("page"); // reset to page 1 on new search
      navigate(`?${params}`, { replace: true });
    }, 350);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]); // navigate/searchParams are stable refs; omitting avoids re-trigger loop

  // Navigate to newly created/duplicated template.
  const fetcherData = fetcher.data as Record<string, unknown> | undefined;
  if (fetcherData?.ok && fetcherData?.newId && typeof fetcherData.newId === "string") {
    if (fetcherData?.intent !== "import-spectora") {
      navigate(`/templates/${fetcherData.newId}/edit`);
    }
  }

  // Show the concept-mapping card once after a successful Spectora import (if not already seen).
  const prevImportIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      fetcherData?.ok &&
      fetcherData?.intent === "import-spectora" &&
      typeof fetcherData.newId === "string" &&
      fetcherData.newId !== prevImportIdRef.current &&
      !spectoraMappingSeen
    ) {
      prevImportIdRef.current = fetcherData.newId as string;
      setMappingModalOpen(true);
    }
  }, [fetcherData, spectoraMappingSeen]);

  /* ---- Sort (search filtering is now server-side via URL ?q=) ---- */
  const filtered = useMemo(() => {
    const list = [...templates];
    list.sort((a, b) => {
      switch (sortBy) {
        case "name": return a.name.localeCompare(b.name);
        case "date": return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
        case "usage": return (b.usageCount || 0) - (a.usageCount || 0);
        default: return 0;
      }
    });
    return list;
  }, [templates, sortBy]);

  const imported = templates.filter((t) => t.marketplaceTemplateId).length;
  const withUpdates = templates.filter((t) => t.upstreamUpdateAvailable).length;

  /* ---- Actions ---- */
  const handleCreate = () => {
    if (!newName.trim()) return;
    fetcher.submit({ intent: "create", name: newName.trim() }, { method: "post" });
    setCreateOpen(false);
    setNewName("");
  };

  const handleDuplicate = (t: Template) => {
    fetcher.submit(
      { intent: "duplicate", id: t.id, name: t.name, schema: JSON.stringify(t.schema || { schemaVersion: 2, sections: [] }) },
      { method: "post" },
    );
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    fetcher.submit({ intent: "delete", id: deleteConfirm }, { method: "post" });
    setDeleteConfirm(null);
  };

  const handleImport = () => {
    if (!importName.trim() || !importPayload.trim()) return;
    fetcher.submit(
      { intent: "import-spectora", name: importName.trim(), payload: importPayload.trim() },
      { method: "post" },
    );
    setImportOpen(false);
    setImportName("");
    setImportPayload("");
  };

  const handleMappingDismiss = () => {
    // Navigate to the imported template if we have its id, then mark seen.
    setMappingModalOpen(false);
    setMappingSeenOptimistic(true);
    mappingFetcher.submit({ intent: "mark-spectora-mapping-seen" }, { method: "post" });
    // Navigate to the newly imported template after dismissing the modal.
    if (fetcherData?.newId && typeof fetcherData.newId === "string") {
      navigate(`/templates/${fetcherData.newId}/edit`);
    }
  };

  /* ---- Meta text ---- */
  const metaParts: string[] = [
    templates.length === 1
      ? m.templates_list_count_one({ count: templates.length })
      : m.templates_list_count_other({ count: templates.length }),
  ];
  if (imported > 0) metaParts.push(m.templates_list_meta_imported({ count: imported }));
  if (withUpdates > 0) metaParts.push(m.templates_list_meta_updates({ count: withUpdates }));

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: m.templates_breadcrumb_library(), href: "/library" }, { label: m.templates_breadcrumb_current() }]} />
      <PageHeader
        title={m.templates_list_heading()}
        meta={metaParts.join(" · ")}
        actions={
          <>
            <button onClick={() => setImportOpen(true)} className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted inline-flex items-center gap-2">
              <Icon name="download" size={16} strokeWidth={1.75} />
              {m.templates_action_import_spectora()}
            </button>
            <button onClick={() => setCreateOpen(true)} className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 inline-flex items-center gap-2">
              {m.templates_action_new_template()}
            </button>
          </>
        }
      />

      {/* Filter bar — search / sort / view. Kept out of the header so a wide
          toolbar can never squeeze the title into a wrap (DS PageHeader owns the
          title/actions split; controls that scale with content live here). */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={m.templates_search_placeholder()}
            className="h-9 w-44 pl-8 pr-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-2 focus:border-ih-primary focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
          />
          <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-9 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-3 outline-none"
        >
          <option value="name">{m.templates_col_name()}</option>
          <option value="date">{m.templates_sort_date()}</option>
          <option value="usage">{m.templates_sort_usage()}</option>
        </select>
        <div className="flex bg-ih-bg-muted rounded-md p-0.5 ml-auto">
          <button
            onClick={() => setView("card")}
            className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "card" ? "bg-ih-bg-card text-ih-primary shadow-ih-card" : "text-ih-fg-3"}`}
          >
            {m.templates_view_cards()}
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "list" ? "bg-ih-bg-card text-ih-primary shadow-ih-card" : "text-ih-fg-3"}`}
          >
            {m.templates_view_list()}
          </button>
        </div>
      </div>

      {/* List view */}
      {view === "list" && (
        <TemplatesListView
          filtered={filtered}
          searchQuery={searchQuery}
          setImportOpen={setImportOpen}
          setCreateOpen={setCreateOpen}
          handleDuplicate={handleDuplicate}
          setDeleteConfirm={setDeleteConfirm}
        />
      )}

      {/* Card view */}
      {view === "card" && (
        <TemplatesCardView
          filtered={filtered}
          searchQuery={searchQuery}
          setImportOpen={setImportOpen}
          setCreateOpen={setCreateOpen}
          handleDuplicate={handleDuplicate}
          setDeleteConfirm={setDeleteConfirm}
        />
      )}

      <Pagination
        page={meta.page}
        pageSize={meta.pageSize}
        total={meta.total}
        totalPages={meta.totalPages}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {/* Create modal */}
      <CreateTemplateModal
        open={createOpen}
        setCreateOpen={setCreateOpen}
        newName={newName}
        setNewName={setNewName}
        handleCreate={handleCreate}
        error={fetcherData?.error}
      />

      {/* Import Spectora modal */}
      <ImportSpectoraModal
        open={importOpen}
        setImportOpen={setImportOpen}
        importName={importName}
        setImportName={setImportName}
        importPayload={importPayload}
        setImportPayload={setImportPayload}
        handleImport={handleImport}
      />

      {/* Delete confirmation modal */}
      <DeleteTemplateModal
        open={deleteConfirm !== null}
        setDeleteConfirm={setDeleteConfirm}
        handleDelete={handleDelete}
      />

      {/* Concept-mapping modal — shown once after first Spectora import */}
      <SpectoraMappingModal open={mappingModalOpen} handleMappingDismiss={handleMappingDismiss} />
    </div>
  );
}
