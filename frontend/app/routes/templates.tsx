import { useState, useMemo, useCallback } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/templates";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Templates - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Template {
  id: string;
  name: string;
  version: number;
  description?: string;
  source?: string;
  marketplaceTemplateId?: string;
  upstreamUpdateAvailable?: boolean;
  usageCount?: number;
  itemCount?: number;
  createdAt?: string;
  updatedAt?: string;
  schema?: {
    schemaVersion?: number;
    sections?: { id: string; title?: string; name?: string; items?: unknown[] }[];
  };
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections/templates", { token });
    const data = res.ok ? await res.json() : {};
    const raw = (data as Record<string, unknown>)?.data;
    const templates: Template[] = Array.isArray(raw)
      ? raw
      : (raw as Record<string, unknown>)?.templates
        ? ((raw as Record<string, unknown>).templates as Template[])
        : [];
    return { templates, token };
  } catch {
    return { templates: [] as Template[], token: "" };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    const res = await apiFetch("/api/inspections/templates", {
      token,
      method: "POST",
      body: JSON.stringify({ name, schema: { schemaVersion: 2, sections: [] } }),
    });
    if (res.ok) {
      const result = await res.json();
      const newId = (result as Record<string, unknown>)?.data
        ? ((result as Record<string, unknown>).data as Record<string, unknown>)?.template
          ? (((result as Record<string, unknown>).data as Record<string, unknown>).template as Record<string, unknown>)?.id
          : null
        : null;
      return { ok: true, newId };
    }
    const err = await res.json().catch(() => ({}));
    return { error: (err as Record<string, unknown>)?.message || "Failed to create" };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    const res = await apiFetch(`/api/inspections/templates/${id}`, { token, method: "DELETE" });
    return { ok: res.ok, intent: "delete" };
  }

  if (intent === "duplicate") {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const schema = formData.get("schema") as string;
    const res = await apiFetch("/api/inspections/templates", {
      token,
      method: "POST",
      body: JSON.stringify({
        name: name + " (Copy)",
        schema: schema ? JSON.parse(schema) : { schemaVersion: 2, sections: [] },
      }),
    });
    if (res.ok) {
      const result = await res.json();
      const newId = (result as Record<string, unknown>)?.data
        ? ((result as Record<string, unknown>).data as Record<string, unknown>)?.template
          ? (((result as Record<string, unknown>).data as Record<string, unknown>).template as Record<string, unknown>)?.id
          : null
        : null;
      return { ok: true, newId, intent: "duplicate" };
    }
    return { error: "Duplication failed", intent: "duplicate" };
  }

  if (intent === "import-spectora") {
    const name = (formData.get("name") as string)?.trim();
    const payload = (formData.get("payload") as string)?.trim();
    if (!name || !payload) return { error: "Name and JSON are required" };
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch (e) { return { error: "Invalid JSON" }; }
    const res = await apiFetch("/api/inspections/templates/import-spectora", {
      token,
      method: "POST",
      body: JSON.stringify({ name, spectora: parsed }),
    });
    if (res.ok) {
      const result = await res.json();
      const d = (result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const newId = d?.template ? (d.template as Record<string, unknown>)?.id : null;
      const stats = d?.stats as Record<string, unknown> | undefined;
      return { ok: true, newId, stats, intent: "import-spectora" };
    }
    const err = await res.json().catch(() => ({}));
    return { error: (err as Record<string, unknown>)?.message || "Import failed" };
  }

  return { ok: false };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type SortKey = "name" | "date" | "usage";

function countItems(t: Template): number {
  if (t.itemCount != null) return t.itemCount;
  const sections = t.schema?.sections;
  if (!Array.isArray(sections)) return 0;
  return sections.reduce((acc, s) => acc + (Array.isArray(s.items) ? s.items.length : 0), 0);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [view, setView] = useState<"list" | "card">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [importName, setImportName] = useState("");
  const [importPayload, setImportPayload] = useState("");

  // Navigate to newly created/duplicated template
  const fetcherData = fetcher.data as Record<string, unknown> | undefined;
  if (fetcherData?.ok && fetcherData?.newId && typeof fetcherData.newId === "string") {
    navigate(`/templates/${fetcherData.newId}/edit`);
  }

  /* ---- Filter + Sort ---- */
  const filtered = useMemo(() => {
    let list = [...templates];

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q),
      );
    }

    // Sort
    list.sort((a, b) => {
      switch (sortBy) {
        case "name": return a.name.localeCompare(b.name);
        case "date": return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
        case "usage": return (b.usageCount || 0) - (a.usageCount || 0);
        default: return 0;
      }
    });

    return list;
  }, [templates, searchQuery, sortBy]);

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

  /* ---- Meta text ---- */
  const metaParts: string[] = [`${templates.length} template${templates.length === 1 ? "" : "s"}`];
  if (imported > 0) metaParts.push(`${imported} imported from Marketplace`);
  if (withUpdates > 0) metaParts.push(`${withUpdates} with updates available`);

  return (
    <div className="space-y-[18px]">
      {/* PageHeader */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library &middot; Templates
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">
            Inspection Templates
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            {metaParts.join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="h-9 w-44 pl-8 pr-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none placeholder:text-slate-400"
            />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-9 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] font-bold text-slate-600 dark:text-slate-300 outline-none"
          >
            <option value="name">Name</option>
            <option value="date">Last modified</option>
            <option value="usage">Most used</option>
          </select>
          {/* View toggle */}
          <div className="flex bg-slate-100 dark:bg-slate-700 rounded-md p-0.5">
            <button
              onClick={() => setView("card")}
              className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "card" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500"}`}
            >
              Cards
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "list" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500"}`}
            >
              List
            </button>
          </div>
          <button onClick={() => setImportOpen(true)} className="h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center gap-2">
            &darr; Import Spectora
          </button>
          <button onClick={() => setCreateOpen(true)} className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2">
            + New Template
          </button>
        </div>
      </div>

      {/* List view */}
      {view === "list" && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Version</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Items</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-[13px] text-slate-500">
                    {searchQuery ? "No templates match your search." : "No templates yet. Create one or import from Spectora."}
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const items = countItems(t);
                  return (
                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-indigo-50 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shrink-0">
                            <TemplateIcon />
                          </div>
                          <div>
                            <Link to={`/templates/${t.id}/edit`} className="text-[13px] font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                              {t.name}
                            </Link>
                            {t.source === "marketplace" && (
                              <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">Marketplace</span>
                            )}
                            {t.description && (
                              <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{t.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center rounded border border-indigo-100 dark:border-indigo-800 px-1.5 py-0.5 text-[10px] font-bold bg-indigo-50/50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                          v{t.version || 1}.0
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[13px] text-slate-500 font-bold">
                        {items} items
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-3">
                          <Link to={`/templates/${t.id}/edit`} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700">
                            Edit
                          </Link>
                          <button onClick={() => handleDuplicate(t)} className="text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-indigo-600 transition-colors">
                            Duplicate
                          </button>
                          <button onClick={() => setDeleteConfirm(t.id)} className="text-[11px] font-bold text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Card view */}
      {view === "card" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.length === 0 ? (
            <div className="col-span-full text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                {searchQuery ? "No matching templates" : "No templates yet"}
              </p>
              <p className="text-[13px] text-slate-500 mt-1">
                Create one or import from Spectora.
              </p>
            </div>
          ) : (
            filtered.map((t) => {
              const items = countItems(t);
              return (
                <div
                  key={t.id}
                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-2 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                >
                  <div>
                    <Link to={`/templates/${t.id}/edit`} className="text-[14px] font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                      {t.name}
                    </Link>
                    {t.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">{t.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                    <span className="inline-flex items-center rounded border border-indigo-100 dark:border-indigo-800 px-1.5 py-0.5 bg-indigo-50/50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                      v{t.version || 1}.0
                    </span>
                    <span>{items} items</span>
                    <span>used {t.usageCount || 0}&times;</span>
                    {t.source === "marketplace" && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-100 px-1 py-0.5 rounded">MP</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 pt-1 border-t border-slate-100 dark:border-slate-700 mt-auto">
                    <Link to={`/templates/${t.id}/edit`} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors">
                      Edit
                    </Link>
                    <button onClick={() => handleDuplicate(t)} className="text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-indigo-600 transition-colors">
                      Duplicate
                    </button>
                    <button onClick={() => setDeleteConfirm(t.id)} className="text-[11px] font-bold text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors ml-auto">
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">New Template</h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg">&times;</button>
            </div>
            <div>
              <label className="block text-[12px] font-bold text-slate-500 mb-1">Template name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. Residential Full"
                autoFocus
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="flex justify-end mt-5">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create Template
              </button>
            </div>
            {typeof fetcherData?.error === "string" && (
              <p className="mt-3 text-[12px] text-red-500 font-medium">{fetcherData.error}</p>
            )}
          </div>
        </div>
      )}

      {/* Import Spectora modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setImportOpen(false)}>
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">Import from Spectora</h2>
              <button onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg">&times;</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-slate-500 mb-1">Template name</label>
                <input
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="e.g. Spectora Residential"
                  className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-500 mb-1">Spectora export JSON</label>
                <textarea
                  value={importPayload}
                  onChange={(e) => setImportPayload(e.target.value)}
                  rows={8}
                  placeholder='Paste your Spectora export JSON here...'
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[12px] font-mono outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>
            <div className="flex justify-end mt-5 gap-2">
              <button onClick={() => setImportOpen(false)} className="h-8 px-4 rounded-md border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!importName.trim() || !importPayload.trim()}
                className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="w-full max-w-xs bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100 mb-2">Delete Template</h2>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-5">
              Are you sure you want to delete this template? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="h-8 px-4 rounded-md border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                Cancel
              </button>
              <button onClick={handleDelete} className="h-8 px-4 rounded-md bg-red-600 text-white font-bold text-[13px] hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function TemplateIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
