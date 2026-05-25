import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { SectionRail } from "~/components/editor/SectionRail";
import { ItemList } from "~/components/editor/ItemList";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { SideRail } from "~/components/editor/SideRail";
import { SpeedMode } from "~/components/editor/SpeedMode";
import { FooterBar } from "~/components/editor/FooterBar";
import { useKeyboard } from "~/hooks/useKeyboard";

export function meta() {
  return [{ title: "Edit Inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SchemaSection {
  id: string;
  title: string;
  items: SchemaItem[];
}

interface SchemaItem {
  id: string;
  label: string;
  type: string;
  tabs?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const id = params.id;

  // Fetch inspection + results in parallel
  const [inspRes, resultsRes] = await Promise.all([
    apiFetch(`/api/inspections/${id}`, { token }),
    apiFetch(`/api/inspections/${id}/results`, { token }),
  ]);

  const inspData = inspRes.ok
    ? ((await inspRes.json()) as Record<string, unknown>)
    : {};
  const resultsData = resultsRes.ok
    ? ((await resultsRes.json()) as Record<string, unknown>)
    : {};

  const data = inspData?.data as Record<string, unknown> | undefined;
  const inspection = (data?.inspection as Record<string, unknown>) || {
    id,
    propertyAddress: "Loading...",
    status: "draft",
  };
  const schema = ((data?.templateSnapshot ||
    (data?.template as Record<string, unknown>)?.schema) as {
    sections: SchemaSection[];
  }) || { sections: [] };
  const results =
    (resultsData?.data as Record<string, Record<string, unknown>>) || {};

  return { inspection, schema, results, token };
}

/* ------------------------------------------------------------------ */
/*  Action (BFF relay for client mutations)                            */
/* ------------------------------------------------------------------ */

export async function action({ request, params }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "rate") {
    const itemId = String(formData.get("itemId"));
    const sectionId = String(formData.get("sectionId"));
    const rating = String(formData.get("rating"));
    await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ field: "rating", value: rating, sectionId }),
    });
  }

  if (intent === "notes") {
    const itemId = String(formData.get("itemId"));
    const sectionId = String(formData.get("sectionId"));
    const notes = String(formData.get("notes"));
    await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ field: "notes", value: notes, sectionId }),
    });
  }

  if (intent === "toggle-canned") {
    const itemId = String(formData.get("itemId"));
    const sectionId = String(formData.get("sectionId"));
    const tabName = String(formData.get("tabName"));
    const cannedId = String(formData.get("cannedId"));
    const included = formData.get("included") === "true";
    await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        field: "cannedToggle",
        value: { tabName, cannedId, included },
        sectionId,
      }),
    });
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const RATING_IDS = ["SAT", "MON", "DEF", "NI", "NP"];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Save status type                                                   */
/* ------------------------------------------------------------------ */
type SaveStatus = "idle" | "saving" | "saved";

export default function InspectionEditPage() {
  const { inspection, schema, results: initialResults } =
    useLoaderData<typeof loader>();

  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [results, setResults] = useState(initialResults);
  const [activeSection, setActiveSection] = useState(
    schema.sections?.[0]?.id || "",
  );
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [speedMode, setSpeedMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Track fetcher state for save indicator */
  useEffect(() => {
    if (fetcher.state === "submitting") {
      setSaveStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    } else if (fetcher.state === "idle" && saveStatus === "saving") {
      setSaveStatus("saved");
      saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [fetcher.state]);

  /* Helper: count photos for an item result */
  const getPhotoCount = (itemId: string): number => {
    const r = getResult(itemId);
    const photos = r.photos as unknown[] | undefined;
    return Array.isArray(photos) ? photos.length : 0;
  };

  const currentSection = schema.sections?.find(
    (s: SchemaSection) => s.id === activeSection,
  );
  const currentItems = currentSection?.items || [];

  /* Helper: get result for an item */
  const getResult = (itemId: string): Record<string, unknown> => {
    const key = `_default:${activeSection}:${itemId}`;
    return (
      (results[key] as Record<string, unknown>) ||
      (results[itemId] as Record<string, unknown>) ||
      {}
    );
  };

  /* Mutation helpers */
  const updateResult = (
    itemId: string,
    field: string,
    value: unknown,
  ) => {
    const key = `_default:${activeSection}:${itemId}`;
    setResults((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as Record<string, unknown> || {}), [field]: value },
    }));
  };

  /* Navigation helpers */
  const navigateToItem = useCallback((direction: "next" | "prev") => {
    if (!activeItemId || currentItems.length === 0) {
      if (direction === "next" && currentItems.length > 0) {
        setActiveItemId(currentItems[0].id);
      }
      return;
    }
    const currentIdx = currentItems.findIndex((i: SchemaItem) => i.id === activeItemId);
    if (direction === "next" && currentIdx < currentItems.length - 1) {
      setActiveItemId(currentItems[currentIdx + 1].id);
    } else if (direction === "prev" && currentIdx > 0) {
      setActiveItemId(currentItems[currentIdx - 1].id);
    }
  }, [activeItemId, currentItems]);

  /* Auto-advance to next unrated item */
  const advanceToNextUnrated = useCallback(() => {
    if (!activeItemId) return;
    const currentIdx = currentItems.findIndex((i: SchemaItem) => i.id === activeItemId);
    for (let i = currentIdx + 1; i < currentItems.length; i++) {
      const key = `_default:${activeSection}:${currentItems[i].id}`;
      const r = (results[key] as Record<string, unknown>) ||
                (results[currentItems[i].id] as Record<string, unknown>) ||
                {};
      if (!r.rating) {
        setActiveItemId(currentItems[i].id);
        return;
      }
    }
    // If no unrated items ahead, just advance to next
    if (currentIdx < currentItems.length - 1) {
      setActiveItemId(currentItems[currentIdx + 1].id);
    }
  }, [activeItemId, activeSection, currentItems, results]);

  /* Rating handler with auto-advance */
  const handleRating = useCallback((rating: string) => {
    if (!activeItemId) return;
    updateResult(activeItemId, "rating", rating);
    fetcher.submit(
      { intent: "rate", itemId: activeItemId, sectionId: activeSection, rating },
      { method: "POST" },
    );
    // Auto-advance after a short delay so the user sees the selection
    setTimeout(() => advanceToNextUnrated(), 150);
  }, [activeItemId, activeSection, fetcher, advanceToNextUnrated]);

  /* Canned comment toggle handler */
  const handleToggleCanned = useCallback((tabName: string, cannedId: string, included: boolean) => {
    if (!activeItemId) return;
    const key = `_default:${activeSection}:${activeItemId}`;
    setResults((prev) => {
      const existing = (prev[key] as Record<string, unknown>) || {};
      const existingTabs = (existing.tabs as Record<string, Array<{ cannedId: string; included: boolean }>>) || {};
      const tabEntries = [...(existingTabs[tabName] || [])];
      const idx = tabEntries.findIndex(e => e.cannedId === cannedId);
      if (idx >= 0) {
        tabEntries[idx] = { ...tabEntries[idx], included };
      } else {
        tabEntries.push({ cannedId, included });
      }
      return {
        ...prev,
        [key]: {
          ...existing,
          tabs: { ...existingTabs, [tabName]: tabEntries },
        },
      };
    });
    fetcher.submit(
      {
        intent: "toggle-canned",
        itemId: activeItemId,
        sectionId: activeSection,
        tabName,
        cannedId,
        included: String(included),
      },
      { method: "POST" },
    );
  }, [activeItemId, activeSection, fetcher]);

  /* Completion progress */
  const progress = useMemo(() => {
    const allSections = schema.sections || [];
    let total = 0;
    let rated = 0;
    for (const section of allSections) {
      for (const item of section.items || []) {
        if (item.type === "rich") {
          total++;
          const key = `_default:${section.id}:${item.id}`;
          const r = (results[key] as Record<string, unknown>) ||
                    (results[item.id] as Record<string, unknown>) ||
                    {};
          if (r.rating) rated++;
        }
      }
    }
    return { total, rated, pct: total > 0 ? Math.round((rated / total) * 100) : 0 };
  }, [schema.sections, results]);

  /* Speed mode item index */
  const speedModeIndex = currentItems.findIndex((i: SchemaItem) => i.id === activeItemId);

  /* Keyboard shortcuts */
  const keyboardHandlers = useMemo(() => ({
    onRate: (level: number) => {
      if (level >= 1 && level <= 5 && activeItemId) {
        const ratingId = RATING_IDS[level - 1];
        handleRating(ratingId);
      }
    },
    onNextItem: () => navigateToItem("next"),
    onPrevItem: () => navigateToItem("prev"),
    onToggleSpeed: () => setSpeedMode((prev) => !prev),
    onOpenLibrary: () => {
      // Library tab toggle is handled via SideRail; for now focus the notes field
    },
    onPhoto: () => {
      // Photo capture — placeholder for future implementation
    },
  }), [activeItemId, handleRating, navigateToItem]);

  useKeyboard(keyboardHandlers, true);

  return (
    <div className="flex h-screen bg-white dark:bg-slate-900">
      {/* ------------------------------------------------------------ */}
      {/*  SpeedMode overlay                                            */}
      {/* ------------------------------------------------------------ */}
      {speedMode && (
        <SpeedMode
          item={activeItemId ? currentItems.find((i: SchemaItem) => i.id === activeItemId) || null : null}
          sectionTitle={currentSection?.title || ""}
          result={activeItemId ? getResult(activeItemId) : {}}
          onRating={(rating) => {
            if (!activeItemId) return;
            updateResult(activeItemId, "rating", rating);
            fetcher.submit(
              { intent: "rate", itemId: activeItemId, sectionId: activeSection, rating },
              { method: "POST" },
            );
          }}
          onPrev={() => navigateToItem("prev")}
          onNext={() => navigateToItem("next")}
          onExit={() => setSpeedMode(false)}
          currentIndex={speedModeIndex >= 0 ? speedModeIndex : 0}
          totalCount={currentItems.length}
        />
      )}

      {/* ------------------------------------------------------------ */}
      {/*  PageChrome - fixed top header with progress bar              */}
      {/* ------------------------------------------------------------ */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 gap-3">
          <a
            href="/dashboard"
            className="w-9 h-9 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 12H5M12 19l-7-7 7-7"
              />
            </svg>
          </a>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold truncate">
              {(inspection as Record<string, unknown>).propertyAddress as string ||
                "Inspection"}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              #{String((inspection as Record<string, unknown>).id)
                .slice(0, 8)
                .toUpperCase()}
            </div>
          </div>

          {/* Completion progress */}
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
              {progress.rated}/{progress.total}
            </span>
          </div>

          {/* Save status indicator */}
          {saveStatus !== "idle" && (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${
              saveStatus === "saving"
                ? "text-amber-500"
                : "text-emerald-500"
            }`}>
              {saveStatus === "saving" ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </>
              )}
            </span>
          )}

          <span className="px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600 inline-flex items-center">
            {(inspection as Record<string, unknown>).status as string}
          </span>

          {/* Publish button */}
          <button
            onClick={() => navigate(`/inspections/${(inspection as Record<string, unknown>).id}/edit?publish=1`)}
            className="h-9 px-4 rounded-md bg-emerald-600 text-white font-bold text-[12px] hover:bg-emerald-700 transition-colors inline-flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Publish
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/*  4-column layout below header (with bottom padding for footer) */}
      {/* ------------------------------------------------------------ */}
      <div className="flex flex-1 pt-14 pb-9">
        {/* Column 1: Section Rail (200px) */}
        <SectionRail
          sections={schema.sections || []}
          activeSection={activeSection}
          onSelect={(id) => {
            setActiveSection(id);
            setActiveItemId(null);
          }}
          results={results}
        />

        {/* Column 2: Item List (280px) */}
        <ItemList
          items={currentItems}
          sectionId={activeSection}
          activeItemId={activeItemId}
          onSelect={(id) => setActiveItemId(id)}
          results={results}
        />

        {/* Column 3: Item Editor (flex-1, focal) */}
        <main className="flex-1 overflow-y-auto border-t-2 border-indigo-600 p-6">
          {activeItemId ? (
            <ItemEditor
              item={currentItems.find((i: SchemaItem) => i.id === activeItemId)}
              sectionTitle={currentSection?.title}
              result={getResult(activeItemId)}
              onRating={handleRating}
              onNotes={(notes) => {
                updateResult(activeItemId, "notes", notes);
              }}
              onNotesBlur={(notes) => {
                fetcher.submit(
                  { intent: "notes", itemId: activeItemId, sectionId: activeSection, notes },
                  { method: "POST" },
                );
              }}
              onToggleCanned={handleToggleCanned}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p className="text-[13px]">
                Select an item from the list to start editing
              </p>
            </div>
          )}
        </main>

        {/* Column 4: SideRail */}
        <SideRail
          activeItem={
            activeItemId
              ? currentItems.find((i: SchemaItem) => i.id === activeItemId) || null
              : null
          }
        />
      </div>

      {/* ------------------------------------------------------------ */}
      {/*  Footer Bar                                                    */}
      {/* ------------------------------------------------------------ */}
      <FooterBar />
    </div>
  );
}
