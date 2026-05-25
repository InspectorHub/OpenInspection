import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { SectionRail } from "~/components/editor/SectionRail";
import { ItemList } from "~/components/editor/ItemList";
import { ItemEditor } from "~/components/editor/ItemEditor";

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

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InspectionEditPage() {
  const { inspection, schema, results: initialResults } =
    useLoaderData<typeof loader>();

  const fetcher = useFetcher();

  const [results, setResults] = useState(initialResults);
  const [activeSection, setActiveSection] = useState(
    schema.sections?.[0]?.id || "",
  );
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

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
    value: string,
  ) => {
    const key = `_default:${activeSection}:${itemId}`;
    setResults((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as Record<string, unknown> || {}), [field]: value },
    }));
  };

  return (
    <div className="flex h-screen bg-white dark:bg-slate-900">
      {/* ------------------------------------------------------------ */}
      {/*  PageChrome - fixed top header                                */}
      {/* ------------------------------------------------------------ */}
      <div className="fixed top-0 left-0 right-0 z-50 h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 gap-3">
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
        <span className="px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600 inline-flex items-center">
          {(inspection as Record<string, unknown>).status as string}
        </span>
      </div>

      {/* ------------------------------------------------------------ */}
      {/*  4-column layout below header                                 */}
      {/* ------------------------------------------------------------ */}
      <div className="flex flex-1 pt-14">
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
              onRating={(rating) => {
                updateResult(activeItemId, "rating", rating);
                fetcher.submit(
                  { intent: "rate", itemId: activeItemId, sectionId: activeSection, rating },
                  { method: "POST" },
                );
              }}
              onNotes={(notes) => {
                updateResult(activeItemId, "notes", notes);
              }}
              onNotesBlur={(notes) => {
                fetcher.submit(
                  { intent: "notes", itemId: activeItemId, sectionId: activeSection, notes },
                  { method: "POST" },
                );
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p className="text-[13px]">
                Select an item from the list to start editing
              </p>
            </div>
          )}
        </main>

        {/* Column 4: SideRail placeholder (44px tab strip) */}
        <aside className="w-11 flex-shrink-0 bg-slate-50 dark:bg-slate-800/50 border-l border-slate-200 dark:border-slate-700 flex flex-col items-center py-2 gap-1">
          {["Preview", "Library", "Recall"].map((tab) => (
            <button
              key={tab}
              className="w-10 flex flex-col items-center gap-0.5 py-2.5 rounded-r-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              title={tab}
            >
              <span
                className="text-[8px] font-bold uppercase tracking-[0.1em]"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                }}
              >
                {tab}
              </span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}

