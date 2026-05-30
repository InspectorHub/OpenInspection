import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/conflict-resolver";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Resolve Conflicts - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Conflict {
  id: string;
  itemId: string;
  sectionId: string | null;
  field: string;
  section: string;
  item: string;
  base: string | null;
  yours: string | null;
  theirs: string | null;
}

/** Renders a persisted conflict value (stored as JSON) for display. */
function toDisplay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const inspectionId = url.searchParams.get("inspection") || "";

  if (!inspectionId) {
    return { conflicts: [] as Conflict[], inspectionId: "", error: "No inspection specified" };
  }

  try {
    const api = createApi(context, { token });
    const res = await api.inspections[":id"].conflicts.$get({ param: { id: inspectionId } });
    if (!res.ok) {
      return { conflicts: [] as Conflict[], inspectionId, error: "No conflicts found" };
    }
    const body = await res.json();
    const conflicts: Conflict[] = body.data.conflicts.map((c) => ({
      id: c.id,
      itemId: c.itemId,
      sectionId: c.sectionId,
      field: c.field,
      section: c.sectionId ?? "—",
      item: c.itemId,
      base: toDisplay(c.base),
      yours: toDisplay(c.local),
      theirs: toDisplay(c.remote),
    }));
    return { conflicts, inspectionId, error: null };
  } catch {
    return { conflicts: [] as Conflict[], inspectionId, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

type Resolution = {
  itemId: string;
  sectionId: string | null;
  field: string;
  chosen: "local" | "remote" | "base";
};

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const inspectionId = String(formData.get("inspectionId") || "");

  // Each resolved conflict submits a JSON-encoded `resolve:<id>` hidden field
  // carrying { itemId, sectionId, field, chosen } — the exact shape the typed
  // POST /conflicts/resolve route accepts.
  const resolutions: Resolution[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("resolve:")) continue;
    try {
      const r = JSON.parse(String(value)) as Resolution;
      if (r.itemId && r.field && r.chosen) resolutions.push(r);
    } catch {
      // skip malformed entries
    }
  }

  if (resolutions.length === 0) return { error: "No resolutions selected" };

  try {
    const api = createApi(context, { token });
    const res = await api.inspections[":id"].conflicts.resolve.$post({
      param: { id: inspectionId },
      json: { resolutions },
    });
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

                {/* Hidden input for form submission — carries the typed
                    resolution shape the POST route accepts (yours→local,
                    theirs→remote). */}
                {choice && (
                  <input
                    type="hidden"
                    name={`resolve:${c.id}`}
                    value={JSON.stringify({
                      itemId: c.itemId,
                      sectionId: c.sectionId,
                      field: c.field,
                      chosen:
                        choice === "yours"
                          ? "local"
                          : choice === "theirs"
                            ? "remote"
                            : "base",
                    })}
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
