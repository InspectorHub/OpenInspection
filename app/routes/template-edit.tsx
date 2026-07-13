import { useState, useEffect, useMemo } from "react";
import { useLoaderData, useFetcher, Link, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/template-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { Icon, Button, TabStrip } from "@core/shared-ui";
import { RATING_PRESETS } from "~/components/template/types";
import type { RatingLevel, RatingSystem, TemplateItem, TemplateSchema, TemplateSection, CannedComment } from "~/components/template/types";
import { RatingSystemEditor } from "~/components/RatingSystemEditor";
import { toEditorLevel, fromEditorLevel } from "~/lib/editor/rating-level-adapter";
import { ItemPropertiesPanel } from "~/components/template/ItemPropertiesPanel";
import { ItemCommentsPanel } from "~/components/template/ItemCommentsPanel";
import { ItemPreviewPanel } from "~/components/template/ItemPreviewPanel";
import { SectionAuthorHeader } from "~/components/template/SectionAuthorHeader";
import { SectionPreview } from "~/components/template/SectionPreview";
import { SectionRail } from "~/components/editor-shared/SectionRail";
import { ItemList } from "~/components/editor-shared/ItemList";
import { TemplatePropertyTypePanel } from "~/components/template/TemplatePropertyTypePanel";
import { serializeTemplateMeta, serializeSectionMeta } from "~/lib/editor/template-meta";
import type { PropertyType } from "~/components/template/types";
import { CommentLibraryDrawer } from "~/components/editor/CommentLibraryDrawer";
import { useCannedComments } from "~/hooks/useCannedComments";
import { buildCannedFromText, TAB_SEVERITY, type CannedTab } from "~/lib/editor/canned-from-library";

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
  const [res, defectCatRes] = await Promise.all([
    api.inspections.templates[":id"].$get({ param: { id } }),
    // Authoring unification Plan-4 module K — the tenant's defect categories,
    // fetched ONCE here (seeded on first read) so the editor can build a
    // single name/id → color lookup for the defects-tab chip.
    api.defectCategories["defect-categories"].$get().catch(() => null),
  ]);
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
  // Authoring unification Plan-4 module K — tenant defect categories (id/name/color).
  let defectCategories: Array<{ id: string; name: string; color: string }> = [];
  if (defectCatRes?.ok) {
    const defectCatBody = await defectCatRes.json() as { data?: Array<{ id: string; name: string; color: string }> };
    defectCategories = defectCatBody.data ?? [];
  }
  return { id, name, version, schema, token, defectCategories };
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
  const { id, name: initialName, version: initialVersion, schema: initial, defectCategories } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  // Authoring unification Plan-4 module K — one tenant-wide category → color
  // lookup, built once from the loader's single fetch, keyed by BOTH name and
  // id (mirroring the report's + inspection editor's resolution).
  const catColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of defectCategories ?? []) {
      map.set(c.name, c.color);
      map.set(c.id, c.color);
    }
    return map;
  }, [defectCategories]);

  const [templateName, setTemplateName] = useState(initialName);
  const [sections, setSections] = useState<TemplateSection[]>(initial.sections || []);
  const [propertyType, setPropertyType] = useState<PropertyType | undefined>(initial.propertyType);
  const [commercialSubtype, setCommercialSubtype] = useState<string | undefined>(initial.commercialSubtype);
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
  const activeSectionId = sections[activeSection]?.id ?? "";
  const findSectionIdx = (id: string) => sections.findIndex((s) => s.id === id);
  const selectSectionById = (id: string) => {
    const idx = findSectionIdx(id);
    if (idx >= 0) { setActiveSection(idx); setEditingItem(null); }
  };

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

  function reorderSection(fromId: string, toId: string) {
    const activeId = sections[activeSection]?.id;
    let nextIdx = activeSection;
    updateSections((s) => {
      const from = s.findIndex((sec) => sec.id === fromId);
      const to = s.findIndex((sec) => sec.id === toId);
      if (from < 0 || to < 0 || from === to) return s;
      const [moved] = s.splice(from, 1);
      s.splice(to, 0, moved);
      nextIdx = s.findIndex((sec) => sec.id === activeId);
      return s;
    });
    if (nextIdx >= 0) setActiveSection(nextIdx);
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

  function duplicateItem(itemId: string) {
    if (!section) return;
    const newId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    updateSections((s) => {
      const items = s[activeSection].items;
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx < 0) return s;
      const clone = structuredClone(items[idx]);
      clone.id = newId;
      clone.label = `${clone.label} (copy)`;
      items.splice(idx + 1, 0, clone);
      return s;
    });
    setEditingItem(newId);
    setRightRail("properties");
  }

  function reorderItem(fromId: string, toId: string) {
    updateSections((s) => {
      const items = s[activeSection].items;
      const from = items.findIndex((i) => i.id === fromId);
      const to = items.findIndex((i) => i.id === toId);
      if (from < 0 || to < 0 || from === to) return s;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
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

  /* ---- Save ---- */
  function toV2Payload(): Record<string, unknown> {
    return {
      schemaVersion: 2,
      ...serializeTemplateMeta(propertyType, commercialSubtype),
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.icon ? { icon: s.icon } : {}),
        ...(s.identifier ? { identifier: s.identifier } : {}),
        ...(s.disclaimerText ? { disclaimerText: s.disclaimerText } : {}),
        ...(s.alwaysPageBreak ? { alwaysPageBreak: true } : {}),
        ...(s.source?.platform ? { source: s.source } : {}),
        ...serializeSectionMeta(s),
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
          if (typeof l.pausesAdvance === "boolean") lv.pausesAdvance = l.pausesAdvance;
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

  // Module C — shared comment-library drawer, hard-filtered by item + rating.
  const [libraryTab, setLibraryTab] = useState<CannedTab | null>(null);
  const [commentLibrarySearch, setCommentLibrarySearch] = useState("");
  const [commentLibrarySelectedIdx, setCommentLibrarySelectedIdx] = useState(0);
  const [serverComments, setServerComments] = useState<Array<{ id: string; text: string; useCount?: number; lastUsedAt?: number | null }>>([]);

  // Reuse the inspection editor's hook verbatim. `inspectionId` is only a load
  // key for the tenant library route; the template id is a stable, unique key.
  // `severityForRatingId` is unused on this surface (we pass the severity
  // explicitly via TAB_SEVERITY), so a constant identity is sufficient.
  const comments = useCannedComments({
    inspectionId: id,
    severityForRatingId: () => "all",
  });

  useEffect(() => {
    if (!libraryTab || !selectedItem) { setServerComments([]); return; }
    const ctx: { itemLabel?: string; section?: string; severity?: string; search?: string } = {
      itemLabel: selectedItem.label,
      severity: TAB_SEVERITY[libraryTab], // hard severity filter = the tab
    };
    if (section?.title) ctx.section = section.title; // hard item-context filter
    const q = commentLibrarySearch.trim();
    if (q.length >= 2) ctx.search = q;
    let cancelled = false;
    const t = setTimeout(() => {
      comments.fetchFiltered(ctx).then((rows) => {
        if (cancelled) return;
        setServerComments(rows as Array<{ id: string; text: string; useCount?: number; lastUsedAt?: number | null }>);
      });
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
    // `selectedItem`/`section` are recomputed each render from state; depend on the
    // stable ids so the effect re-runs on item/section change, not every render.
  }, [libraryTab, selectedItem?.id, section?.id, commentLibrarySearch, comments.sort, comments.fetchFiltered]);

  /* ---- Append a picked library comment to a tab (module C) ---- */
  function addCannedFromLibrary(tab: CannedTab, text: string) {
    if (!editingItem || !section) return;
    updateSections((s) => {
      const item = s[activeSection].items.find((i) => i.id === editingItem);
      if (!item || item.type !== "rich") return s;
      if (!item.tabs) item.tabs = { information: [], limitations: [], defects: [] };
      item.tabs[tab].push(buildCannedFromText(tab, text));
      return s;
    });
  }

  function openCommentLibrary(tab: CannedTab) {
    comments.setFilterMode("auto"); // ensure item context rides fetchFiltered
    setCommentLibrarySearch("");
    setCommentLibrarySelectedIdx(0);
    setLibraryTab(tab);
  }

  // Stable reference so the shared editor's seed effect (keyed on the `system`
  // prop identity) does not re-seed and discard in-progress edits on unrelated
  // re-renders while the modal is open.
  const editorSystem = useMemo(
    () => ({ id, name: ratingSystem.name || "Rating System", slug: "template", levels: ratingSystem.levels.map(toEditorLevel) }),
    [id, ratingSystem],
  );

  return (
    <div className="flex flex-col h-screen bg-ih-bg-app">
      {/* Toolbar */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-ih-border bg-ih-bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/library/templates" className="inline-flex items-center gap-1 text-ih-fg-4 hover:text-ih-fg-2 text-[13px]"><Icon name="chevL" size={14} /> Templates</Link>
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            className="text-[14px] font-bold bg-transparent border-b border-transparent focus:border-ih-primary outline-none text-ih-fg-1 w-48"
          />
          <span className="text-[10px] font-mono text-ih-fg-4">v{initialVersion}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Bespoke: active "watch" tone would fight Button's ghost hover/selected treatment. */}
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`h-7 px-3 rounded-md text-[12px] font-bold transition-colors ${previewMode ? "bg-ih-watch-bg text-ih-watch-fg" : "bg-ih-bg-muted text-ih-fg-3"}`}
          >
            {previewMode ? "Exit Preview" : "Preview"}
          </button>
          <Button variant="secondary" size="sm" onClick={() => setRatingModalOpen(true)}>
            Rating System
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            {fetcher.state === "submitting" ? "Saving..." : saveSuccess ? "Saved!" : "Save"}
          </Button>
        </div>
      </header>

      <div className="flex items-center h-10 px-4 border-b border-ih-border bg-ih-bg-card shrink-0">
        <TemplatePropertyTypePanel
          propertyType={propertyType}
          commercialSubtype={commercialSubtype}
          onChange={(patch) => { setPropertyType(patch.propertyType); setCommercialSubtype(patch.commercialSubtype); }}
        />
      </div>

      {fetcherData?.error && (
        <div className="px-4 py-2 bg-ih-bad-bg text-ih-bad-fg text-[12px] font-medium">
          {fetcherData.error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Section rail */}
        <SectionRail
          mode="author"
          sections={sections}
          activeSection={activeSectionId}
          onSelect={selectSectionById}
          onAddSection={addSection}
          onMoveSection={(id, dir) => {
            const idx = findSectionIdx(id);
            if (idx >= 0) moveSection(idx, dir);
          }}
          onDeleteSection={(id) => {
            const idx = findSectionIdx(id);
            if (idx >= 0) removeSection(idx);
          }}
          onReorderSection={reorderSection}
        />

        {/* Item nav (center column) */}
        <div className="w-[280px] shrink-0 flex flex-col overflow-hidden">
          {section && <SectionAuthorHeader section={section} activeSection={activeSection} renameSection={renameSection} updateSections={updateSections} />}
          {section ? (
            previewMode ? (
              <div className="flex-1 overflow-y-auto p-3"><SectionPreview section={section} /></div>
            ) : (
              <ItemList
                mode="author"
                items={section.items}
                sectionId={section.id}
                activeItemId={editingItem}
                onSelect={(id) => { setEditingItem(id); setRightRail("properties"); }}
                onAddItem={addItem}
                onDuplicateItem={duplicateItem}
                onDeleteItem={removeItem}
                onMoveItem={(id, dir) => { const idx = section.items.findIndex((i) => i.id === id); if (idx >= 0) moveItem(idx, dir); }}
                onReorderItem={reorderItem}
              />
            )
          ) : (
            <div className="flex-1 flex items-center justify-center text-[13px] text-ih-fg-4">Add a section to get started</div>
          )}
        </div>

        {/* Right rail (item properties) — now the main editor area */}
        {selectedItem && !previewMode && (
          <aside className="flex-1 border-l border-ih-border bg-ih-bg-card overflow-y-auto">
            {/* Rail tabs */}
            <TabStrip
              tabs={[
                { id: "properties", label: "Properties" },
                { id: "comments", label: "Comments" },
                { id: "preview", label: "Preview" },
              ]}
              activeId={rightRail}
              onChange={(id) => setRightRail(id as "properties" | "comments" | "preview")}
            />

            <div className="p-4 space-y-3 max-w-xl">
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
                  onOpenLibrary={openCommentLibrary}
                  categoryColor={catColor}
                />
              )}

              {rightRail === "preview" && (
                <ItemPreviewPanel selectedItem={selectedItem} categoryColor={catColor} />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Comment library drawer (shared with inspection editor; hard-filtered) */}
      {libraryTab && selectedItem && section && (
        <CommentLibraryDrawer
          open              // required prop (CommentLibraryDrawer.tsx: `open: boolean`); host mounts only while open
          comments={{
            filterMode: "auto",            // locked: item context always rides
            setFilterMode: () => {},       // template hard-filters — no auto/all toggle
            sort: comments.sort,
            setSort: comments.setSort,
            touchSnippet: comments.touchSnippet,
          }}
          state={{
            activeItem: { label: selectedItem.label },
            currentSection: { id: section.id, title: section.title },
            activeItemId: selectedItem.id,
            getResult: () => ({}),          // template authoring has no per-item rating result
            commentLibraryFilter: TAB_SEVERITY[libraryTab], // severity chip pinned to the tab's severity
            setCommentLibraryFilter: () => {},            // locked
            setCommentLibrarySelectedIdx,
            commentLibrarySearch,
            setCommentLibrarySearch,
            commentLibrarySelectedIdx,
            setShowCommentLibrary: (open: boolean) => { if (!open) setLibraryTab(null); },
          }}
          serverComments={serverComments}
          onInsert={(_sectionId, _itemId, text) => addCannedFromLibrary(libraryTab, text)}
          onClose={() => setLibraryTab(null)}
        />
      )}

      {/* Rating system editor — canonical editor shared with /library/rating-systems (module F).
          `onSaveLevels` writes back onto the template's own schema instead of POSTing to the
          library table. */}
      <RatingSystemEditor
        open={ratingModalOpen}
        onClose={() => setRatingModalOpen(false)}
        system={editorSystem}
        onSaveLevels={(levels) => {
          setRatingSystem((prev) => {
            const nextLevels = levels.map((l, i) => {
              const next = fromEditorLevel(l, i);
              // Preserve per-level fields the shared editor does not author
              // (description feeds inspection helpers.backfillLevelDescriptions;
              // `default` is a legacy per-level flag) by re-attaching from the
              // prior level with the same id.
              const old = prev.levels.find((o) => o.id === next.id);
              if (old) {
                if (old.description !== undefined) next.description = old.description;
                if (old.default !== undefined) next.default = old.default;
              }
              return next;
            });
            const defaultLevelId = nextLevels.some((l) => l.id === prev.defaultLevelId)
              ? prev.defaultLevelId
              : nextLevels[0]?.id;
            return { ...prev, levels: nextLevels, defaultLevelId };
          });
        }}
      />
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
    <div className="flex flex-col items-center justify-center h-screen bg-ih-bg-app gap-3 px-6 text-center">
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      <Link to="/library/templates" className="h-8 px-4 inline-flex items-center rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600">
        Back to Templates
      </Link>
    </div>
  );
}
