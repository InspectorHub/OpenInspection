import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/form-renderer";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Inspection Form - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TemplateItem {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "multi_select" | "textarea" | "date" | "photo_only" | "rich";
  options?: string[];
  required?: boolean;
}

interface TemplateSection {
  id: string;
  title: string;
  items: TemplateItem[];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const id = params.id;

  try {
    const res = await apiFetch(`/api/inspections/${id}`, { token });
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const data = json.data as Record<string, unknown> | undefined;
    const template = (data?.templateSnapshot ?? (data?.template as Record<string, unknown>)?.schema) as {
      sections: TemplateSection[];
    } | null;

    return {
      inspectionId: id,
      sections: template?.sections ?? [],
      error: res.ok ? null : "Inspection not found",
    };
  } catch {
    return { inspectionId: id, sections: [] as TemplateSection[], error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, params }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const entries: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    entries[key] = String(value);
  }

  try {
    const res = await apiFetch(`/api/inspections/${params.id}/results/batch`, {
      method: "POST",
      token,
      body: JSON.stringify({ results: entries }),
    });
    if (!res.ok) return { error: "Failed to save results" };
    return { success: true };
  } catch {
    return { error: "Network error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Field renderer                                                     */
/* ------------------------------------------------------------------ */

function FormField({ item }: { item: TemplateItem }) {
  const base =
    "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none";

  switch (item.type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name={item.id}
            value="true"
            className="accent-indigo-600"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {item.label}
          </span>
        </label>
      );
    case "select":
      return (
        <select name={item.id} className={base}>
          <option value="">Select...</option>
          {item.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "multi_select":
      return (
        <select name={item.id} multiple className={`${base} min-h-[80px]`}>
          {item.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "textarea":
      return (
        <textarea
          name={item.id}
          rows={3}
          className={base}
          placeholder={item.label}
        />
      );
    case "number":
      return (
        <input
          name={item.id}
          type="number"
          className={base}
          placeholder={item.label}
        />
      );
    case "date":
      return <input name={item.id} type="date" className={base} />;
    case "photo_only":
      return (
        <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-[13px] text-slate-400">
          Photo capture is available in the inspection editor
        </div>
      );
    default:
      return (
        <input
          name={item.id}
          type="text"
          className={base}
          placeholder={item.label}
        />
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FormRendererPage() {
  const { inspectionId, sections, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const fetcherData = fetcher.data as { success?: boolean; error?: string } | undefined;
  const isSaving = fetcher.state === "submitting";

  if (error) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Form Unavailable
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400 mb-1">
            Inspection Form
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Field Checklist
          </h1>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
            #{String(inspectionId || "").slice(0, 8).toUpperCase()}
          </p>
        </div>
        <a
          href="/dashboard"
          className="h-8 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Dashboard
        </a>
      </div>

      {/* Success message */}
      {fetcherData?.success && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-[13px] font-medium text-emerald-700 dark:text-emerald-300 text-center">
          Results saved successfully.
        </div>
      )}

      {/* Error message */}
      {fetcherData?.error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[13px] font-medium text-red-700 dark:text-red-300 text-center">
          {fetcherData.error}
        </div>
      )}

      <fetcher.Form method="post" className="space-y-8">
        {sections.map((section) => (
          <fieldset
            key={section.id}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5"
          >
            <legend className="text-sm font-bold text-slate-900 dark:text-slate-100 px-1">
              {section.title}
              <span className="ml-2 text-[10px] text-slate-400 font-mono">
                {section.items.length} {section.items.length === 1 ? "item" : "items"}
              </span>
            </legend>
            <div className="space-y-4 mt-3">
              {section.items.map((item) => (
                <div key={item.id}>
                  {item.type !== "boolean" && (
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                      {item.label}
                      {item.required && (
                        <span className="text-red-500 ml-0.5">*</span>
                      )}
                    </label>
                  )}
                  <FormField item={item} />
                </div>
              ))}
            </div>
          </fieldset>
        ))}

        {sections.length > 0 && (
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving..." : "Save Results"}
          </button>
        )}

        {sections.length === 0 && (
          <div className="p-6 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-[13px] text-slate-400">
            No template sections found for this inspection.
          </div>
        )}
      </fetcher.Form>
    </div>
  );
}
