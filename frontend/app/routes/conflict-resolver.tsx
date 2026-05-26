import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/conflict-resolver";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Resolve Conflicts - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Conflict {
  id: string;
  field: string;
  section: string;
  item: string;
  base: string | null;
  yours: string | null;
  theirs: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const inspectionId = url.searchParams.get("inspection") || "";

  if (!inspectionId) {
    return { conflicts: [] as Conflict[], inspectionId: "", error: "No inspection specified" };
  }

  try {
    const res = await apiFetch(
      `/api/inspections/${inspectionId}/conflicts`,
      { token },
    );
    if (!res.ok) {
      return { conflicts: [] as Conflict[], inspectionId, error: "No conflicts found" };
    }
    const body = await res.json();
    return {
      conflicts: ((body as Record<string, unknown>).data ?? []) as Conflict[],
      inspectionId,
      error: null,
    };
  } catch {
    return { conflicts: [] as Conflict[], inspectionId, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const inspectionId = String(formData.get("inspectionId") || "");
  const resolutions: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("resolve:")) {
      resolutions[key.replace("resolve:", "")] = String(value);
    }
  }

  try {
    const res = await apiFetch(
      `/api/inspections/${inspectionId}/conflicts/resolve`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ resolutions }),
      },
    );
    if (!res.ok) return { error: "Failed to resolve conflicts" };
    return { success: true };
  } catch {
    return { error: "Network error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ConflictResolverPage() {
  const { conflicts, inspectionId, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [resolved, setResolved] = useState<Record<string, "yours" | "theirs" | "base">>({});

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1">
          Conflict Resolver
        </h1>
        <p className="text-ih-fg-3 mt-2">{error}</p>
      </div>
    );
  }

  const allResolved = conflicts.length > 0 && Object.keys(resolved).length === conflicts.length;

  return (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ih-fg-1">
          Resolve Conflicts
        </h1>
        <p className="text-[13px] text-ih-fg-3 mt-1">
          {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""} detected — choose which version to keep for each field.
        </p>
      </div>

      <fetcher.Form method="post">
        <input type="hidden" name="inspectionId" value={inspectionId} />

        <div className="space-y-4">
          {conflicts.map((c) => {
            const choice = resolved[c.id];
            const resolvedValue =
              choice === "yours" ? c.yours : choice === "theirs" ? c.theirs : c.base;

            return (
              <div
                key={c.id}
                className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden"
              >
                {/* Field label */}
                <div className="px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border">
                  <p className="text-[13px] font-semibold text-ih-fg-1">
                    {c.item}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {c.section} / {c.field}
                  </p>
                </div>

                {/* Three columns */}
                <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-700">
                  {/* Base */}
                  <button
                    type="button"
                    onClick={() => setResolved((p) => ({ ...p, [c.id]: "base" }))}
                    className={`p-4 text-left transition-colors ${
                      choice === "base"
                        ? "bg-ih-primary-tint ring-2 ring-inset ring-indigo-500"
                        : "hover:bg-ih-bg-muted/30"
                    }`}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                      Base
                    </p>
                    <p className="text-[13px] text-ih-fg-3">
                      {c.base ?? <span className="italic text-slate-400">empty</span>}
                    </p>
                  </button>

                  {/* Yours */}
                  <button
                    type="button"
                    onClick={() => setResolved((p) => ({ ...p, [c.id]: "yours" }))}
                    className={`p-4 text-left transition-colors ${
                      choice === "yours"
                        ? "bg-ih-ok-bg ring-2 ring-inset ring-emerald-500"
                        : "hover:bg-ih-bg-muted/30"
                    }`}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-widest text-ih-ok-fg mb-2">
                      Yours
                    </p>
                    <p className="text-[13px] text-ih-fg-3">
                      {c.yours ?? <span className="italic text-slate-400">empty</span>}
                    </p>
                  </button>

                  {/* Theirs */}
                  <button
                    type="button"
                    onClick={() => setResolved((p) => ({ ...p, [c.id]: "theirs" }))}
                    className={`p-4 text-left transition-colors ${
                      choice === "theirs"
                        ? "bg-ih-watch-bg ring-2 ring-inset ring-amber-500"
                        : "hover:bg-ih-bg-muted/30"
                    }`}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-widest text-ih-watch-fg mb-2">
                      Theirs
                    </p>
                    <p className="text-[13px] text-ih-fg-3">
                      {c.theirs ?? <span className="italic text-slate-400">empty</span>}
                    </p>
                  </button>
                </div>

                {/* Hidden input for form submission */}
                {choice && (
                  <input
                    type="hidden"
                    name={`resolve:${c.id}`}
                    value={resolvedValue ?? ""}
                  />
                )}
              </div>
            );
          })}
        </div>

        {conflicts.length > 0 && (
          <div className="mt-6 flex items-center justify-between">
            <p className="text-[13px] text-ih-fg-3">
              {Object.keys(resolved).length} of {conflicts.length} resolved
            </p>
            <button
              type="submit"
              disabled={!allResolved}
              className="h-10 px-6 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply Resolutions
            </button>
          </div>
        )}
      </fetcher.Form>
    </div>
  );
}
