import { useState } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/template-edit";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Edit Template - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TemplateItem {
  id: string;
  label: string;
  type: string;
  tabs?: unknown;
}

interface TemplateSection {
  id: string;
  title: string;
  items: TemplateItem[];
}

interface TemplateSchema {
  sections: TemplateSection[];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const id = params.id;
  const res = await apiFetch(`/api/inspections/templates/${id}`, { token });
  const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  const data = (json?.data || {}) as Record<string, unknown>;
  return {
    id,
    name: (data.name as string) || "Untitled Template",
    schema: (data.schema as TemplateSchema) || { sections: [] },
    token,
  };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, params }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const schema = formData.get("schema");
  if (!schema) return { error: "No schema" };
  await apiFetch(`/api/inspections/templates/${params.id}`, {
    token,
    method: "PUT",
    body: JSON.stringify({ schema: JSON.parse(schema as string) }),
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Page — BareLayout (no sidebar)                                     */
/* ------------------------------------------------------------------ */

const ITEM_TYPES = ["rich", "boolean", "text", "textarea", "number", "select", "date", "photo_only"] as const;

export default function TemplateEditPage() {
  const { id, name, schema: initial } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [sections, setSections] = useState<TemplateSection[]>(initial.sections);
  const [activeSection, setActiveSection] = useState(0);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  const section = sections[activeSection] || null;

  /* --- Helpers --- */
  function updateSections(fn: (s: TemplateSection[]) => TemplateSection[]) {
    setSections((prev) => fn([...prev]));
  }

  function addSection() {
    const id = `sec_${Date.now()}`;
    updateSections((s) => [...s, { id, title: "New Section", items: [] }]);
    setActiveSection(sections.length);
  }

  function removeSection(idx: number) {
    updateSections((s) => { s.splice(idx, 1); return s; });
    if (activeSection >= sections.length - 1) setActiveSection(Math.max(0, sections.length - 2));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    updateSections((s) => {
      const target = idx + dir;
      if (target < 0 || target >= s.length) return s;
      [s[idx], s[target]] = [s[target], s[idx]];
      return s;
    });
    setActiveSection(Math.max(0, Math.min(sections.length - 1, activeSection + dir)));
  }

  function addItem() {
    if (!section) return;
    const itemId = `item_${Date.now()}`;
    updateSections((s) => {
      s[activeSection].items.push({ id: itemId, label: "New Item", type: "rich" });
      return s;
    });
  }

  function removeItem(itemId: string) {
    updateSections((s) => {
      s[activeSection].items = s[activeSection].items.filter((i) => i.id !== itemId);
      return s;
    });
    if (editingItem === itemId) setEditingItem(null);
  }

  function moveItem(itemIdx: number, dir: -1 | 1) {
    updateSections((s) => {
      const items = s[activeSection].items;
      const target = itemIdx + dir;
      if (target < 0 || target >= items.length) return s;
      [items[itemIdx], items[target]] = [items[target], items[itemIdx]];
      return s;
    });
  }

  function updateItem(itemId: string, patch: Partial<TemplateItem>) {
    updateSections((s) => {
      const item = s[activeSection].items.find((i) => i.id === itemId);
      if (item) Object.assign(item, patch);
      return s;
    });
  }

  function handleSave() {
    fetcher.submit(
      { schema: JSON.stringify({ sections }) },
      { method: "post" },
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] dark:bg-slate-900">
      {/* Toolbar */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/templates" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-[13px]">&larr; Templates</Link>
          <span className="text-[14px] font-bold text-slate-900 dark:text-slate-100">{name}</span>
        </div>
        <button onClick={handleSave} className="h-7 px-3 rounded-md bg-indigo-600 text-white font-bold text-[12px] hover:bg-indigo-700">
          {fetcher.state === "submitting" ? "Saving..." : "Save"}
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Section rail */}
        <aside className="w-[200px] shrink-0 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {sections.map((s, i) => (
              <div key={s.id} className={`group flex items-center rounded-md transition-all ${i === activeSection ? "bg-indigo-50 dark:bg-indigo-900/20" : "hover:bg-slate-100 dark:hover:bg-slate-700/50"}`}>
                <button onClick={() => setActiveSection(i)} className={`flex-1 text-left px-3 py-2 text-[13px] truncate ${i === activeSection ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-slate-600 dark:text-slate-400"}`}>
                  {s.title}
                </button>
                <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
                  <button onClick={() => moveSection(i, -1)} className="text-slate-400 hover:text-slate-600 text-[10px]">&uarr;</button>
                  <button onClick={() => moveSection(i, 1)} className="text-slate-400 hover:text-slate-600 text-[10px]">&darr;</button>
                  <button onClick={() => removeSection(i)} className="text-slate-400 hover:text-red-500 text-[10px]">&times;</button>
                </div>
              </div>
            ))}
            <button onClick={addSection} className="w-full text-left px-3 py-2 text-[12px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md">
              + Add Section
            </button>
          </div>
        </aside>

        {/* Item list + inline editor */}
        <div className="flex-1 overflow-y-auto p-4">
          {section ? (
            <div className="max-w-2xl mx-auto space-y-3">
              {/* Section title inline edit */}
              <input
                value={section.title}
                onChange={(e) => updateSections((s) => { s[activeSection].title = e.target.value; return s; })}
                className="text-[18px] font-bold bg-transparent border-b-2 border-transparent focus:border-indigo-600 outline-none w-full text-slate-900 dark:text-slate-100"
              />

              {/* Items */}
              {section.items.map((item, idx) => (
                <div key={item.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-[10px] font-mono text-slate-400 w-5">{String(idx + 1).padStart(2, "0")}</span>
                      {editingItem === item.id ? (
                        <input value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} onBlur={() => setEditingItem(null)} autoFocus className="flex-1 text-[13px] font-medium bg-transparent border-b border-indigo-600 outline-none text-slate-900 dark:text-slate-100" />
                      ) : (
                        <button onClick={() => setEditingItem(item.id)} className="flex-1 text-left text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate hover:text-indigo-600">{item.label}</button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <select value={item.type} onChange={(e) => updateItem(item.id, { type: e.target.value })} className="h-6 px-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 border-0 outline-none">
                        {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button onClick={() => moveItem(idx, -1)} className="w-5 h-5 text-slate-400 hover:text-slate-600 text-[10px]">&uarr;</button>
                      <button onClick={() => moveItem(idx, 1)} className="w-5 h-5 text-slate-400 hover:text-slate-600 text-[10px]">&darr;</button>
                      <button onClick={() => removeItem(item.id)} className="w-5 h-5 text-slate-400 hover:text-red-500 text-[10px]">&times;</button>
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={addItem} className="w-full py-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-[12px] font-bold text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                + Add Item
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[13px] text-slate-400">
              Add a section to get started
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
