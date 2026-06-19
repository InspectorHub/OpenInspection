import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, Link, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/template-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Edit Template - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CannedComment {
  id: string;
  title: string;
  comment: string;
  default?: boolean;
  category?: string;
  location?: string;
  photos?: string[];
}

interface ItemOptions {
  min?: number | null;
  max?: number | null;
  unit?: string;
  step?: number | null;
  placeholder?: string;
  maxLength?: number | null;
  choices?: string[];
  minPhotos?: number | null;
}

interface Attribute {
  id: string;
  name: string;
  type: string;
  choices?: string[];
  unit?: string;
  required?: boolean;
  isSafety?: boolean;
  isDefect?: boolean;
}

interface TemplateItem {
  id: string;
  label: string;
  type: string;
  description?: string;
  icon?: string;
  required?: boolean;
  isSafety?: boolean;
  defaultRecommendation?: string;
  defaultEstimateMin?: number | null;
  defaultEstimateMax?: number | null;
  ratingOptions?: string[];
  tabs?: {
    information: CannedComment[];
    limitations: CannedComment[];
    defects: CannedComment[];
  };
  options?: ItemOptions;
  attributes?: Attribute[];
  source?: { platform: string; externalId: string } | null;
}

interface TemplateSection {
  id: string;
  title: string;
  identifier?: string;
  icon?: string;
  disclaimerText?: string;
  alwaysPageBreak?: boolean;
  items: TemplateItem[];
  source?: { platform: string; externalId: string } | null;
}

interface RatingLevel {
  id: string;
  label: string;
  abbreviation?: string;
  color?: string;
  severity?: string;
  isDefect?: boolean;
  default?: boolean;
  description?: string;
}

interface RatingSystem {
  name?: string;
  defaultLevelId?: string;
  levels: RatingLevel[];
  source?: unknown;
}

interface TemplateSchema {
  schemaVersion: number;
  sections: TemplateSection[];
  ratingSystem?: RatingSystem;
}

/* ------------------------------------------------------------------ */
/*  Rating presets                                                     */
/* ------------------------------------------------------------------ */

const RATING_PRESETS: { name: string; levels: RatingLevel[] }[] = [
  { name: "Standard 3-Level", levels: [
    { id: "S", label: "Satisfactory", abbreviation: "S", color: "#22c55e", severity: "good", isDefect: false, default: true, description: "Item is functioning as intended." },
    { id: "M", label: "Monitor", abbreviation: "M", color: "#f59e0b", severity: "marginal", isDefect: false, default: false, description: "Functional but warrants periodic re-inspection." },
    { id: "D", label: "Defect", abbreviation: "D", color: "#ef4444", severity: "significant", isDefect: true, default: false, description: "Broken or unsafe; recommend repair." },
  ]},
  { name: "Standard 5-Level", levels: [
    { id: "S", label: "Satisfactory", abbreviation: "Sat", color: "#22c55e", severity: "good", isDefect: false, default: true, description: "Item is functioning as intended." },
    { id: "M", label: "Monitor", abbreviation: "Mon", color: "#f59e0b", severity: "marginal", isDefect: false, default: false, description: "Functional but shows wear." },
    { id: "D", label: "Defect", abbreviation: "D", color: "#ef4444", severity: "significant", isDefect: true, default: false, description: "Broken or unsafe." },
    { id: "NI", label: "Not Inspected", abbreviation: "NI", color: "#9ca3af", severity: "minor", isDefect: false, default: false, description: "Could not be inspected." },
    { id: "NP", label: "Not Present", abbreviation: "NP", color: "#6b7280", severity: "minor", isDefect: false, default: false, description: "Not present at this property." },
  ]},
  { name: "TREC", levels: [
    { id: "I", label: "Inspected", abbreviation: "I", color: "#22c55e", severity: "good", isDefect: false, default: true, description: "Meets Texas Standards of Practice." },
    { id: "D", label: "Deficient", abbreviation: "D", color: "#ef4444", severity: "significant", isDefect: true, default: false, description: "Deficiencies warrant repair." },
    { id: "NI", label: "Not Inspected", abbreviation: "NI", color: "#9ca3af", severity: "minor", isDefect: false, default: false, description: "Not inspected per Standards." },
    { id: "NP", label: "Not Present", abbreviation: "NP", color: "#6b7280", severity: "minor", isDefect: false, default: false, description: "Not present." },
    { id: "INR", label: "In Need of Repair", abbreviation: "INR", color: "#f97316", severity: "significant", isDefect: true, default: false, description: "Requires repair." },
  ]},
];

const ITEM_TYPES = ["rich", "boolean", "text", "textarea", "number", "select", "multi_select", "date", "photo_only"] as const;

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const id = params.id;
  const api = createApi(context, { token });
  const res = await api.inspections.templates[":id"].$get({ param: { id } });
  // A non-OK response previously fell through to an empty `{}`, which rendered a
  // section-less editor that looks blank ("the editor never opened"). Surface the
  // failure to the ErrorBoundary instead so the user gets an actionable message.
  if (!res.ok) {
    // res.status is typed to the route's declared success code (200) by the
    // hono client, but the runtime value is the real HTTP status — read it as
    // a number to distinguish a permission failure from a missing template.
    throw new Response("Template not found", { status: (res.status as number) === 403 ? 403 : 404 });
  }
  const body = await res.json();
  const raw = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const tpl = raw?.template ? (raw.template as Record<string, unknown>) : raw;
  const name = (tpl?.name as string) || "Untitled Template";
  const version = (tpl?.version as number) || 1;
  let schema = (tpl?.schema || { schemaVersion: 2, sections: [] }) as TemplateSchema;
  if (typeof schema === "string") {
    try { schema = JSON.parse(schema); } catch { schema = { schemaVersion: 2, sections: [] }; }
  }
  // Normalize name/title. Always coerce `items` to an array so the editor's
  // `section.items.length` / `.map` calls can never crash on a section whose
  // `items` key is absent (which renders as a blank screen via the root
  // ErrorBoundary).
  if (!Array.isArray(schema.sections)) {
    schema.sections = [];
  }
  schema.sections = schema.sections.map((sec) => {
    const s = { ...sec };
    if (!s.title && (s as unknown as Record<string, string>).name) {
      s.title = (s as unknown as Record<string, string>).name;
    }
    s.items = Array.isArray(s.items)
      ? s.items.map((item) => {
          const it = { ...item };
          if (!it.label && (it as unknown as Record<string, string>).name) {
            it.label = (it as unknown as Record<string, string>).name;
          }
          return it;
        })
      : [];
    return s;
  });
  return { id, name, version, schema, token };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, params, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const name = formData.get("name") as string;
  const schemaStr = formData.get("schema") as string;
  if (!schemaStr) return { error: "No schema" };
  const api = createApi(context, { token });
  const res = await api.inspections.templates[":id"].$put({
    param: { id: params.id },
    json: { name, schema: JSON.parse(schemaStr) },
  });
  if (res.ok) {
    const data = await res.json();
    const newVersion = (data as Record<string, unknown>)?.data
      ? ((data as Record<string, unknown>).data as Record<string, unknown>)?.version
      : null;
    return { ok: true, version: newVersion };
  }
  const err = await res.json().catch(() => ({}));
  return { error: (err as Record<string, unknown>)?.message || "Failed to save" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TemplateEditPage() {
  const { name: initialName, version: initialVersion, schema: initial } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [templateName, setTemplateName] = useState(initialName);
  const [sections, setSections] = useState<TemplateSection[]>(initial.sections || []);
  const [ratingSystem, setRatingSystem] = useState<RatingSystem>(
    initial.ratingSystem || { name: "Standard 5-Level", defaultLevelId: "S", levels: RATING_PRESETS[1].levels },
  );
  const [activeSection, setActiveSection] = useState(0);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [rightRail, setRightRail] = useState<"properties" | "comments" | "preview">("properties");
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [choicesText, setChoicesText] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const section = sections[activeSection] || null;

  const fetcherData = fetcher.data as { ok?: boolean; error?: string; version?: number } | undefined;

  useEffect(() => {
    if (fetcherData?.ok) {
      setSaveSuccess(true);
      const timer = setTimeout(() => setSaveSuccess(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [fetcherData]);

  /* ---- Section CRUD ---- */
  function updateSections(fn: (s: TemplateSection[]) => TemplateSection[]) {
    setSections((prev) => fn(structuredClone(prev)));
  }

  function addSection() {
    const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    updateSections((s) => [...s, { id: newId, title: "New Section", items: [] }]);
    setActiveSection(sections.length);
  }

  function renameSection(idx: number, title: string) {
    updateSections((s) => { s[idx].title = title; return s; });
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

  /* ---- Item CRUD ---- */
  function addItem() {
    if (!section) return;
    const itemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    updateSections((s) => {
      s[activeSection].items.push({
        id: itemId,
        label: "New Item",
        type: "rich",
        ratingOptions: ["Inspected", "Not Inspected", "Not Present", "Repair", "Safety Hazard"],
        tabs: { information: [], limitations: [], defects: [] },
        options: { choices: [] },
      });
      return s;
    });
    setEditingItem(itemId);
    setRightRail("properties");
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

  /* ---- Canned comment CRUD ---- */
  function addCannedToItem(tab: "information" | "limitations" | "defects") {
    if (!editingItem || !section) return;
    updateSections((s) => {
      const item = s[activeSection].items.find((i) => i.id === editingItem);
      if (!item || item.type !== "rich") return s;
      if (!item.tabs) item.tabs = { information: [], limitations: [], defects: [] };
      const prefix = tab === "defects" ? "rd_" : tab === "limitations" ? "rl_" : "ri_";
      const newId = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry: CannedComment = { id: newId, title: "New entry", comment: "", default: false };
      if (tab === "defects") {
        entry.category = "recommendation";
        entry.location = "";
        entry.photos = [];
      }
      item.tabs[tab].push(entry);
      return s;
    });
  }

  function removeCannedFromItem(tab: "information" | "limitations" | "defects", idx: number) {
    if (!editingItem || !section) return;
    updateSections((s) => {
      const item = s[activeSection].items.find((i) => i.id === editingItem);
      if (!item?.tabs?.[tab]) return s;
      item.tabs[tab].splice(idx, 1);
      return s;
    });
  }

  /* ---- Rating system ---- */
  function applyPreset(preset: typeof RATING_PRESETS[0]) {
    setRatingSystem({
      name: preset.name,
      defaultLevelId: preset.levels.find((l) => l.default)?.id || preset.levels[0]?.id,
      levels: structuredClone(preset.levels),
    });
  }

  function addRatingLevel() {
    setRatingSystem((prev) => ({
      ...prev,
      levels: [...prev.levels, { id: "NEW", label: "New Level", abbreviation: "", color: "#6b7280", severity: "minor", isDefect: false, default: false, description: "" }],
    }));
  }

  /* ---- Save ---- */
  function toV2Payload(): Record<string, unknown> {
    return {
      schemaVersion: 2,
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.icon ? { icon: s.icon } : {}),
        ...(s.identifier ? { identifier: s.identifier } : {}),
        ...(s.disclaimerText ? { disclaimerText: s.disclaimerText } : {}),
        ...(s.alwaysPageBreak ? { alwaysPageBreak: true } : {}),
        ...(s.source?.platform ? { source: s.source } : {}),
        items: s.items.map((it) => {
          const base: Record<string, unknown> = { id: it.id, label: it.label, type: it.type };
          if (it.description) base.description = it.description;
          if (it.icon) base.icon = it.icon;
          if (typeof it.required === "boolean") base.required = it.required;
          if (typeof it.isSafety === "boolean") base.isSafety = it.isSafety;
          if (it.defaultRecommendation) base.defaultRecommendation = it.defaultRecommendation;
          if (it.attributes?.length) base.attributes = it.attributes;
          if (it.source?.platform) base.source = it.source;
          if (it.type === "rich") {
            base.ratingOptions = it.ratingOptions?.length ? it.ratingOptions : ["Inspected"];
            base.tabs = {
              information: (it.tabs?.information || []).map((c) => ({ id: c.id, title: c.title || "", comment: c.comment || "", default: !!c.default })),
              limitations: (it.tabs?.limitations || []).map((c) => ({ id: c.id, title: c.title || "", comment: c.comment || "", default: !!c.default })),
              defects: (it.tabs?.defects || []).map((c) => ({
                id: c.id, title: c.title || "", category: c.category || "recommendation",
                location: c.location || "", comment: c.comment || "",
                photos: Array.isArray(c.photos) ? c.photos : [], default: !!c.default,
              })),
            };
          } else if (it.type !== "boolean" && it.type !== "date" && it.options) {
            const o: Record<string, unknown> = {};
            if (it.options.choices?.length) o.choices = it.options.choices;
            if (it.options.min != null) o.min = it.options.min;
            if (it.options.max != null) o.max = it.options.max;
            if (it.options.placeholder) o.placeholder = it.options.placeholder;
            if (Object.keys(o).length) base.options = o;
          }
          return base;
        }),
      })),
      ratingSystem: ratingSystem.levels.length ? {
        ...(ratingSystem.name ? { name: ratingSystem.name } : {}),
        ...(ratingSystem.defaultLevelId ? { defaultLevelId: ratingSystem.defaultLevelId } : {}),
        levels: ratingSystem.levels.map((l) => {
          const lv: Record<string, unknown> = { id: l.id, label: l.label };
          if (l.abbreviation) lv.abbreviation = l.abbreviation;
          if (l.color) lv.color = l.color;
          if (l.severity) lv.severity = l.severity;
          if (typeof l.isDefect === "boolean") lv.isDefect = l.isDefect;
          if (typeof l.default === "boolean") lv.default = l.default;
          if (l.description) lv.description = l.description;
          return lv as unknown as RatingLevel;
        }),
      } : undefined,
    };
  }

  function handleSave() {
    fetcher.submit(
      { name: templateName, schema: JSON.stringify(toV2Payload()) },
      { method: "post" },
    );
  }

  /* ---- Currently selected item ---- */
  const selectedItem = section?.items.find((i) => i.id === editingItem) || null;

  // Sync choices text when item changes
  useEffect(() => {
    if (selectedItem?.options?.choices) {
      setChoicesText(selectedItem.options.choices.join("\n"));
    } else {
      setChoicesText("");
    }
  }, [editingItem]);

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] dark:bg-[#0f172a]">
      {/* Toolbar */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-ih-border bg-ih-bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/library/templates" className="text-ih-fg-4 hover:text-ih-fg-2 text-[13px]">&larr; Templates</Link>
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            className="text-[14px] font-bold bg-transparent border-b border-transparent focus:border-ih-primary outline-none text-ih-fg-1 w-48"
          />
          <span className="text-[10px] font-mono text-ih-fg-4">v{initialVersion}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`h-7 px-3 rounded-md text-[12px] font-bold transition-colors ${previewMode ? "bg-ih-watch-bg text-ih-watch-fg" : "bg-ih-bg-muted text-ih-fg-3"}`}
          >
            {previewMode ? "Exit Preview" : "Preview"}
          </button>
          <button onClick={() => setRatingModalOpen(true)} className="h-7 px-3 rounded-md bg-ih-bg-muted text-ih-fg-3 text-[12px] font-bold">
            Rating System
          </button>
          <button onClick={handleSave} className="h-7 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600">
            {fetcher.state === "submitting" ? "Saving..." : saveSuccess ? "Saved!" : "Save"}
          </button>
        </div>
      </header>

      {fetcherData?.error && (
        <div className="px-4 py-2 bg-ih-bad-bg text-ih-bad-fg text-[12px] font-medium">
          {fetcherData.error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Section rail */}
        <aside className="w-[200px] shrink-0 border-r border-ih-border bg-ih-bg-muted overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {sections.map((s, i) => (
              <div key={s.id} className={`group flex items-center rounded-md transition-all ${i === activeSection ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"}`}>
                <button onClick={() => { setActiveSection(i); setEditingItem(null); }} className={`flex-1 text-left px-3 py-2 text-[13px] truncate ${i === activeSection ? "text-ih-primary font-bold" : "text-ih-fg-3"}`}>
                  {s.title}
                  <span className="ml-1 text-[10px] opacity-50">{s.items.length}</span>
                </button>
                <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
                  <button onClick={() => moveSection(i, -1)} className="text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&uarr;</button>
                  <button onClick={() => moveSection(i, 1)} className="text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&darr;</button>
                  <button onClick={() => removeSection(i)} className="text-ih-fg-4 hover:text-ih-bad-fg text-[10px]">&times;</button>
                </div>
              </div>
            ))}
            <button onClick={addSection} className="w-full text-left px-3 py-2 text-[12px] font-bold text-ih-primary hover:bg-ih-primary-tint rounded-md">
              + Add Section
            </button>
          </div>
        </aside>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto p-4">
          {section ? (
            <div className="max-w-2xl mx-auto space-y-3">
              {/* Section title inline edit */}
              <div className="flex items-center gap-2">
                <input
                  value={section.title}
                  onChange={(e) => renameSection(activeSection, e.target.value)}
                  className="text-[18px] font-bold bg-transparent border-b-2 border-transparent focus:border-ih-primary outline-none flex-1 text-ih-fg-1"
                />
                <span className="text-[11px] text-ih-fg-4">{section.items.length} items</span>
              </div>

              {/* Section disclaimer */}
              <input
                value={section.disclaimerText || ""}
                onChange={(e) => updateSections((s) => { s[activeSection].disclaimerText = e.target.value; return s; })}
                placeholder="Section disclaimer (optional)"
                className="w-full text-[12px] text-ih-fg-4 bg-transparent border-b border-transparent focus:border-ih-border-strong outline-none"
              />

              {/* Items */}
              {previewMode ? (
                <div className="space-y-2">
                  {section.items.map((item, idx) => (
                    <div key={item.id} className="bg-ih-bg-card border border-ih-border rounded-lg p-4">
                      <p className="text-[13px] font-bold text-ih-fg-1">
                        {idx + 1}. {item.label}
                      </p>
                      {item.description && <p className="text-[11px] text-ih-fg-4 mt-1">{item.description}</p>}
                      <div className="mt-2">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3">{item.type}</span>
                        {item.type === "rich" && item.ratingOptions && (
                          <div className="flex gap-1 mt-2">
                            {item.ratingOptions.map((opt) => (
                              <span key={opt} className="text-[10px] px-2 py-0.5 rounded border border-ih-border text-ih-fg-3">{opt}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {section.items.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`bg-ih-bg-card border rounded-lg p-3 transition-colors ${editingItem === item.id ? "border-ih-primary shadow-ih-focus" : "border-ih-border"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-[10px] font-mono text-ih-fg-4 w-5 cursor-grab" title="Drag to reorder">&#9776;</span>
                          <span className="text-[10px] font-mono text-ih-fg-4 w-5">{String(idx + 1).padStart(2, "0")}</span>
                          {editingItem === item.id ? (
                            <input
                              value={item.label}
                              onChange={(e) => updateItem(item.id, { label: e.target.value })}
                              autoFocus
                              className="flex-1 text-[13px] font-medium bg-transparent border-b border-ih-primary outline-none text-ih-fg-1"
                            />
                          ) : (
                            <button
                              onClick={() => { setEditingItem(item.id); setRightRail("properties"); }}
                              className="flex-1 text-left text-[13px] font-medium text-ih-fg-1 truncate hover:text-ih-primary"
                            >
                              {item.label}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <select
                            value={item.type}
                            onChange={(e) => updateItem(item.id, { type: e.target.value })}
                            className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-3 border-0 outline-none"
                          >
                            {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <button onClick={() => moveItem(idx, -1)} className="w-5 h-5 text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&uarr;</button>
                          <button onClick={() => moveItem(idx, 1)} className="w-5 h-5 text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&darr;</button>
                          <button onClick={() => removeItem(item.id)} className="w-5 h-5 text-ih-fg-4 hover:text-ih-bad-fg text-[10px]">&times;</button>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button onClick={addItem} className="w-full py-2 rounded-lg border-2 border-dashed border-ih-border text-[12px] font-bold text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors">
                    + Add Item
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[13px] text-ih-fg-4">
              Add a section to get started
            </div>
          )}
        </div>

        {/* Right rail (item properties) */}
        {selectedItem && !previewMode && (
          <aside className="w-[280px] shrink-0 border-l border-ih-border bg-ih-bg-card overflow-y-auto">
            {/* Rail tabs */}
            <div className="flex border-b border-ih-border">
              {(["properties", "comments", "preview"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightRail(tab)}
                  className={`flex-1 py-2 text-[11px] font-bold capitalize border-b-2 transition-colors ${rightRail === tab ? "border-ih-primary text-ih-primary" : "border-transparent text-ih-fg-4 hover:text-ih-fg-2"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="p-3 space-y-3">
              {rightRail === "properties" && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Label</label>
                    <input value={selectedItem.label} onChange={(e) => updateItem(selectedItem.id, { label: e.target.value })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Description</label>
                    <textarea value={selectedItem.description || ""} onChange={(e) => updateItem(selectedItem.id, { description: e.target.value })} rows={2} className="w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Type</label>
                    <select value={selectedItem.type} onChange={(e) => updateItem(selectedItem.id, { type: e.target.value })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none">
                      {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!selectedItem.required} onChange={(e) => updateItem(selectedItem.id, { required: e.target.checked })} className="accent-ih-primary" />
                    <span className="text-[12px] text-ih-fg-3">Required</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!selectedItem.isSafety} onChange={(e) => updateItem(selectedItem.id, { isSafety: e.target.checked })} className="accent-ih-primary" />
                    <span className="text-[12px] text-ih-fg-3">Safety item</span>
                  </label>
                  {(selectedItem.type === "select" || selectedItem.type === "multi_select") && (
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Choices (one per line)</label>
                      <textarea
                        value={choicesText}
                        onChange={(e) => {
                          setChoicesText(e.target.value);
                          updateItem(selectedItem.id, {
                            options: { ...selectedItem.options, choices: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) },
                          });
                        }}
                        rows={4}
                        className="w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none font-mono"
                      />
                    </div>
                  )}
                  {selectedItem.type === "number" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Min</label>
                        <input type="number" value={selectedItem.options?.min ?? ""} onChange={(e) => updateItem(selectedItem.id, { options: { ...selectedItem.options, min: e.target.value ? Number(e.target.value) : null } })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Max</label>
                        <input type="number" value={selectedItem.options?.max ?? ""} onChange={(e) => updateItem(selectedItem.id, { options: { ...selectedItem.options, max: e.target.value ? Number(e.target.value) : null } })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Default recommendation</label>
                    <input value={selectedItem.defaultRecommendation || ""} onChange={(e) => updateItem(selectedItem.id, { defaultRecommendation: e.target.value })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
                  </div>
                </>
              )}

              {rightRail === "comments" && selectedItem.type === "rich" && (
                <>
                  {(["information", "limitations", "defects"] as const).map((tab) => (
                    <div key={tab}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 capitalize">{tab}</span>
                        <button onClick={() => addCannedToItem(tab)} className="text-[10px] font-bold text-ih-primary hover:text-ih-primary">+ Add</button>
                      </div>
                      {(selectedItem.tabs?.[tab] || []).map((c, ci) => (
                        <div key={c.id} className="flex items-start gap-1 mb-1.5">
                          <div className="flex-1">
                            <input
                              value={c.title}
                              onChange={(e) => {
                                updateSections((s) => {
                                  const it = s[activeSection].items.find((i) => i.id === editingItem);
                                  if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].title = e.target.value;
                                  return s;
                                });
                              }}
                              placeholder="Title"
                              className="w-full text-[11px] font-bold bg-transparent border-b border-ih-border outline-none text-ih-fg-2 mb-0.5"
                            />
                            <textarea
                              value={c.comment}
                              onChange={(e) => {
                                updateSections((s) => {
                                  const it = s[activeSection].items.find((i) => i.id === editingItem);
                                  if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].comment = e.target.value;
                                  return s;
                                });
                              }}
                              placeholder="Comment text..."
                              rows={2}
                              className="w-full text-[11px] bg-transparent border border-ih-border rounded px-1 py-0.5 outline-none text-ih-fg-3"
                            />
                          </div>
                          <button onClick={() => removeCannedFromItem(tab, ci)} className="text-ih-fg-4 hover:text-ih-bad-fg text-[10px] mt-1">&times;</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}

              {rightRail === "preview" && (
                <div className="space-y-2">
                  <p className="text-[13px] font-bold text-ih-fg-1">{selectedItem.label}</p>
                  {selectedItem.description && <p className="text-[11px] text-ih-fg-3">{selectedItem.description}</p>}
                  <div className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3 inline-block">{selectedItem.type}</div>
                  {selectedItem.type === "rich" && selectedItem.ratingOptions && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {selectedItem.ratingOptions.map((opt) => (
                        <span key={opt} className="text-[10px] px-2 py-1 rounded border border-ih-border text-ih-fg-3">{opt}</span>
                      ))}
                    </div>
                  )}
                  {selectedItem.tabs && selectedItem.type === "rich" && (
                    <div className="space-y-2 mt-3">
                      {(["information", "limitations", "defects"] as const).map((tab) => {
                        const entries = selectedItem.tabs?.[tab] || [];
                        if (entries.length === 0) return null;
                        return (
                          <div key={tab}>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1 capitalize">{tab}</p>
                            {entries.map((c) => (
                              <p key={c.id} className="text-[11px] text-ih-fg-3 ml-2">- {c.title}: {c.comment}</p>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Rating system modal */}
      {ratingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => setRatingModalOpen(false)}>
          <div className="w-full max-w-lg bg-ih-bg-card rounded-xl shadow-ih-popover p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold text-ih-fg-1">Rating System</h2>
              <button onClick={() => setRatingModalOpen(false)} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg">&times;</button>
            </div>
            {/* Presets */}
            <div className="flex flex-wrap gap-2 mb-4">
              {RATING_PRESETS.map((p) => (
                <button key={p.name} onClick={() => applyPreset(p)} className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-ih-border text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors">
                  {p.name}
                </button>
              ))}
            </div>
            {/* Levels */}
            <div className="space-y-2">
              {ratingSystem.levels.map((level, li) => (
                <div key={level.id + li} className="flex items-center gap-2 p-2 rounded-lg border border-ih-border">
                  <input
                    type="color"
                    value={level.color || "#6b7280"}
                    onChange={(e) => {
                      const next = structuredClone(ratingSystem);
                      next.levels[li].color = e.target.value;
                      setRatingSystem(next);
                    }}
                    className="w-6 h-6 rounded border-0 cursor-pointer"
                  />
                  <input
                    value={level.label}
                    onChange={(e) => {
                      const next = structuredClone(ratingSystem);
                      next.levels[li].label = e.target.value;
                      setRatingSystem(next);
                    }}
                    className="flex-1 text-[12px] font-bold bg-transparent outline-none text-ih-fg-1"
                  />
                  <input
                    value={level.abbreviation || ""}
                    onChange={(e) => {
                      const next = structuredClone(ratingSystem);
                      next.levels[li].abbreviation = e.target.value;
                      setRatingSystem(next);
                    }}
                    placeholder="Abbr"
                    className="w-12 text-[10px] font-mono bg-transparent border-b border-ih-border outline-none text-ih-fg-3 text-center"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-ih-fg-3">
                    <input
                      type="checkbox"
                      checked={!!level.isDefect}
                      onChange={(e) => {
                        const next = structuredClone(ratingSystem);
                        next.levels[li].isDefect = e.target.checked;
                        setRatingSystem(next);
                      }}
                      className="accent-ih-bad-fg"
                    />
                    Defect
                  </label>
                  <button
                    onClick={() => {
                      const next = structuredClone(ratingSystem);
                      next.levels.splice(li, 1);
                      setRatingSystem(next);
                    }}
                    className="text-ih-fg-4 hover:text-ih-bad-fg text-[10px]"
                  >&times;</button>
                </div>
              ))}
            </div>
            <button onClick={addRatingLevel} className="mt-3 text-[12px] font-bold text-ih-primary hover:text-ih-primary">
              + Add level
            </button>
            <div className="flex justify-end mt-5">
              <button onClick={() => setRatingModalOpen(false)} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600">
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
/*  Error boundary                                                     */
/* ------------------------------------------------------------------ */

/**
 * Local boundary so a failed template fetch (404/403) or an unexpected render
 * error surfaces an actionable message + a way back to the list, instead of a
 * blank full-screen editor that looks like "the editor never opened".
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message =
    status === 404
      ? "This template could not be found. It may have been deleted."
      : status === 403
        ? "You do not have permission to edit this template."
        : "Something went wrong while opening the template editor.";

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#f8fafc] dark:bg-[#0f172a] gap-3 px-6 text-center">
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      <Link to="/library/templates" className="h-8 px-4 inline-flex items-center rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600">
        Back to Templates
      </Link>
    </div>
  );
}
