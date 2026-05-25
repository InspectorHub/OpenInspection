import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

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
/*  Rating button config                                               */
/* ------------------------------------------------------------------ */

const RATINGS = [
  {
    id: "SAT",
    label: "Sat",
    active: "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  {
    id: "MON",
    label: "Mon",
    active: "bg-amber-100 text-amber-700 ring-2 ring-amber-400 dark:bg-amber-900/30 dark:text-amber-400",
  },
  {
    id: "DEF",
    label: "Def",
    active: "bg-rose-100 text-rose-700 ring-2 ring-rose-400 dark:bg-rose-900/30 dark:text-rose-400",
  },
  {
    id: "NI",
    label: "N/I",
    active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300",
  },
  {
    id: "NP",
    label: "N/P",
    active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300",
  },
] as const;

/** Map rating to dot color for the item list */
function ratingDotClass(rating: string): string {
  if (rating === "Satisfactory" || rating === "SAT") return "bg-emerald-500";
  if (rating === "Monitor" || rating === "MON") return "bg-amber-500";
  if (rating === "Defect" || rating === "DEF") return "bg-rose-500";
  return "bg-slate-300";
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
        <aside className="w-[200px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50 dark:bg-slate-800/50">
          <nav className="p-2 space-y-0.5">
            {schema.sections?.map((section: SchemaSection) => (
              <button
                key={section.id}
                onClick={() => {
                  setActiveSection(section.id);
                  setActiveItemId(null);
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all ${
                  activeSection === section.id
                    ? "bg-indigo-50 text-indigo-600 font-bold border-l-2 border-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50"
                }`}
              >
                {section.title}
                <span className="ml-1 text-[10px] text-slate-400">
                  {section.items?.length || 0}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Column 2: Item List (280px) */}
        <div className="w-[280px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {currentItems.map((item: SchemaItem, idx: number) => {
              const result = getResult(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveItemId(item.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all flex items-center gap-2 ${
                    activeItemId === item.id
                      ? "bg-white dark:bg-slate-800 shadow-sm border-l-[3px] border-indigo-600 font-medium"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <span className="text-[10px] text-slate-400 font-mono w-5">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {result.rating && (
                    <span
                      className={`w-2 h-2 rounded-full ${ratingDotClass(result.rating as string)}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

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

/* ------------------------------------------------------------------ */
/*  ItemEditor sub-component                                           */
/* ------------------------------------------------------------------ */

function ItemEditor({
  item,
  sectionTitle,
  result,
  onRating,
  onNotes,
  onNotesBlur,
}: {
  item: SchemaItem | undefined;
  sectionTitle: string | undefined;
  result: Record<string, unknown>;
  onRating: (rating: string) => void;
  onNotes: (notes: string) => void;
  onNotesBlur: (notes: string) => void;
}) {
  if (!item) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="text-[11px] text-indigo-600 font-bold uppercase tracking-wide">
          {sectionTitle}
        </div>
        <h2 className="text-[19px] font-bold mt-1">{item.label}</h2>
      </div>

      {/* Rating buttons */}
      {item.type === "rich" && (
        <div className="flex gap-2">
          {RATINGS.map((r) => (
            <button
              key={r.id}
              onClick={() => onRating(r.id)}
              className={`flex-1 h-[52px] rounded-lg text-[13px] font-bold transition-all ${
                result.rating === r.id
                  ? r.active
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Notes textarea */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
          Notes
        </label>
        <textarea
          value={(result.notes as string) || ""}
          onChange={(e) => onNotes(e.target.value)}
          onBlur={(e) => onNotesBlur(e.target.value)}
          placeholder="Add notes — type / for snippets"
          className="w-full h-28 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] resize-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
        />
      </div>
    </div>
  );
}
