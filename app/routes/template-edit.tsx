import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, Link, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/template-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { RATING_PRESETS } from "~/components/template/types";
import type { RatingLevel, RatingSystem, TemplateItem, TemplateSchema, TemplateSection, CannedComment } from "~/components/template/types";
import { RatingSystemModal } from "~/components/template/RatingSystemModal";
import { ItemPropertiesPanel } from "~/components/template/ItemPropertiesPanel";
import { ItemCommentsPanel } from "~/components/template/ItemCommentsPanel";
import { ItemPreviewPanel } from "~/components/template/ItemPreviewPanel";
import { SectionsList } from "~/components/template/SectionsList";
import { SectionRail } from "~/components/template/SectionRail";

export function meta() {
  return [{ title: "Edit Template - OpenInspection" }];
}

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

// Serialize an information/limitations canned comment to its v2 wire shape.
// (Defects carry extra fields and are serialized inline.)
function serializeCanned(c: CannedComment): Record<string, unknown> {
  return { id: c.id, title: c.title || "", comment: c.comment || "", default: !!c.default };
}

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
              information: (it.tabs?.information || []).map(serializeCanned),
              limitations: (it.tabs?.limitations || []).map(serializeCanned),
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
        <SectionRail
          sections={sections}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          setEditingItem={setEditingItem}
          moveSection={moveSection}
          removeSection={removeSection}
          addSection={addSection}
        />

        {/* Item list */}
        <div className="flex-1 overflow-y-auto p-4">
          <SectionsList
            section={section}
            activeSection={activeSection}
            previewMode={previewMode}
            editingItem={editingItem}
            renameSection={renameSection}
            updateSections={updateSections}
            setEditingItem={setEditingItem}
            setRightRail={setRightRail}
            updateItem={updateItem}
            moveItem={moveItem}
            removeItem={removeItem}
            addItem={addItem}
          />
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
                <ItemPropertiesPanel
                  selectedItem={selectedItem}
                  updateItem={updateItem}
                  choicesText={choicesText}
                  setChoicesText={setChoicesText}
                />
              )}

              {rightRail === "comments" && selectedItem.type === "rich" && (
                <ItemCommentsPanel
                  selectedItem={selectedItem}
                  activeSection={activeSection}
                  editingItem={editingItem}
                  updateSections={updateSections}
                  addCannedToItem={addCannedToItem}
                  removeCannedFromItem={removeCannedFromItem}
                />
              )}

              {rightRail === "preview" && (
                <ItemPreviewPanel selectedItem={selectedItem} />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Rating system modal */}
      {ratingModalOpen && (
        <RatingSystemModal
          ratingSystem={ratingSystem}
          setRatingSystem={setRatingSystem}
          applyPreset={applyPreset}
          addRatingLevel={addRatingLevel}
          onClose={() => setRatingModalOpen(false)}
        />
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
