import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/templates";
import { useDisplayTimeZone, useCapability } from "~/hooks/useSessionContext";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { Pagination, PageHeader, Icon } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { usePagination } from "~/hooks/usePagination";
import type { SortKey, Template } from "~/components/templates/types";
import { TemplatesListView } from "~/components/templates/TemplatesListView";
import { TemplatesCardView } from "~/components/templates/TemplatesCardView";
import { CreateTemplateModal } from "~/components/templates/CreateTemplateModal";
import { DeleteTemplateModal } from "~/components/templates/DeleteTemplateModal";
import { importEntryHref } from "~/lib/import-entry-points";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
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
    const res = await api.inspections.templates.$get({ query: { page, pageSize, ...(q ? { q } : {}) } });
    const body = res.ok
      ? ((await res.json()) as { data?: unknown[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } })
      : { data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } };
    const templates = (body.data ?? []) as Template[];
    const meta = body.meta ?? { total: 0, page: 1, pageSize: 50, totalPages: 1 };
    return { templates, meta, q, token };
  } catch {
    return {
      templates: [] as Template[],
      meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      q: "",
      token: "",
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

  return { ok: false };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TemplatesPage() {
  const { templates, meta, q: loaderQ } = useLoaderData<typeof loader>();
  // #106 - create, duplicate and delete all write a template. One guard:
  // they are three separate user paths and only one can be open at a time,
  // so a refused call is not reachable. Import is no longer among them --
  // it is a link to the shared wizard and writes nothing from this page.
  const { fetcher, submit, busy: writing } = useGuardedSubmit();
  const displayTz = useDisplayTimeZone();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setPage, setPageSize } = usePagination();

  // Capabilities are decided where they are ENFORCED (the four gates on
  // server/api/inspections/templates.ts) and only READ here, so this page can
  // never offer an action the API refuses (CLAUDE.md, Cross-Portal Reuse).
  // `useCapability` is fail-closed when there is no session context.
  //
  // HIDDEN, not disabled-with-a-tooltip: a disabled control invites "why?" and
  // the honest answer is a permission the viewer cannot change themselves.
  const canCreate = useCapability("templateCreate");
  const canImport = useCapability("templateImport");
  const canDelete = useCapability("templateDelete");

  const [view, setView] = useState<"list" | "card">("list");
  const [searchQuery, setSearchQuery] = useState(loaderQ);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

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
    navigate(`/templates/${fetcherData.newId}/edit`);
  }

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
    if (!submit({ intent: "create", name: newName.trim() }, { method: "post" })) return;
    setCreateOpen(false);
    setNewName("");
  };

  const handleDuplicate = (t: Template) => {
    submit(
      { intent: "duplicate", id: t.id, name: t.name, schema: JSON.stringify(t.schema || { schemaVersion: 2, sections: [] }) },
      { method: "post" },
    );
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (!submit({ intent: "delete", id: deleteConfirm }, { method: "post" })) return;
    setDeleteConfirm(null);
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
            {canImport && (
              // One front door. The address is built by `importEntryHref` so
              // this control, the two empty states and anything that later
              // points at the wizard cannot drift into three spellings of the
              // same query string.
              <Link
                to={importEntryHref("templates.create")}
                className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted inline-flex items-center gap-2"
              >
                <Icon name="download" size={16} strokeWidth={1.75} />
                {m.templates_action_import()}
              </Link>
            )}
            {canCreate && (
              <button onClick={() => setCreateOpen(true)} className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 inline-flex items-center gap-2">
                {m.templates_action_new_template()}
              </button>
            )}
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
            className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "card" ? "bg-ih-bg-card text-ih-primary-text shadow-ih-card" : "text-ih-fg-3"}`}
          >
            {m.templates_view_cards()}
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "list" ? "bg-ih-bg-card text-ih-primary-text shadow-ih-card" : "text-ih-fg-3"}`}
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
          setCreateOpen={setCreateOpen}
          handleDuplicate={handleDuplicate}
          setDeleteConfirm={setDeleteConfirm}
          timeZone={displayTz}
          canCreate={canCreate}
          canImport={canImport}
          canDelete={canDelete}
        />
      )}

      {/* Card view */}
      {view === "card" && (
        <TemplatesCardView
          filtered={filtered}
          searchQuery={searchQuery}
          setCreateOpen={setCreateOpen}
          handleDuplicate={handleDuplicate}
          setDeleteConfirm={setDeleteConfirm}
          canCreate={canCreate}
          canImport={canImport}
          canDelete={canDelete}
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

      {/* Delete confirmation modal */}
      <DeleteTemplateModal
        open={deleteConfirm !== null}
        setDeleteConfirm={setDeleteConfirm}
        handleDelete={handleDelete}
        busy={writing}
      />
    </div>
  );
}
