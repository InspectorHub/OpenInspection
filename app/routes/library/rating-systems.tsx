import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/rating-systems";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { RatingSystemEditor, type EditorSystem, type RatingBucket } from "~/components/RatingSystemEditor";

export function meta() {
  return [{ title: "Rating Systems - OpenInspection" }];
}

type Level = { id: string; abbr: string; label: string; color: string; bucket: RatingBucket; hotkey?: string; order?: number };
type System = { id: string; name: string; slug: string; description?: string | null; isDefault?: boolean; isSeed?: boolean; levels: Level[] };

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.ratingSystems.index.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { systems: (body.data ?? []) as System[] };
  } catch {
    return { systems: [] as System[] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  const api = createApi(context, { token });

  if (intent === "delete") {
    const id = String(form.get("id") || "");
    const res = await api.ratingSystems[":id"].$delete({ param: { id } });
    return { ok: res.ok, intent: "delete" as const };
  }

  if (intent === "save") {
    const id = form.get("id") ? String(form.get("id")) : null;
    let levels: unknown;
    try { levels = JSON.parse(String(form.get("levels") || "[]")); } catch { return { ok: false, error: "Invalid levels" }; }
    const json = {
      name: String(form.get("name") || ""),
      slug: String(form.get("slug") || ""),
      description: String(form.get("description") || "") || undefined,
      isDefault: form.get("isDefault") === "true",
      levels: levels as Level[],
    };
    const res = id
      ? await api.ratingSystems[":id"].$put({ param: { id }, json })
      : await api.ratingSystems.index.$post({ json });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      return { ok: false, error: errBody?.error?.message || "Failed to save rating system" };
    }
    return { ok: true, intent: "save" as const };
  }

  return { ok: false };
}

const BUCKET_RING: Record<RatingBucket, string> = {
  satisfactory: "ring-ih-ok/30",
  monitor: "ring-ih-watch/30",
  defect: "ring-ih-bad/30",
  na: "ring-ih-border-strong/30",
};

export default function RatingSystemsPage() {
  const { systems } = useLoaderData<typeof loader>();
  const deleteFetcher = useFetcher();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EditorSystem | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(sys: System) {
    // Guard `levels`: a system row may arrive without a `levels` array (the card
    // render already defends with `?? []`). Without the same guard here, spreading
    // `undefined` throws inside the click handler, so the Edit button silently does
    // nothing — exactly the "unresponsive" symptom.
    const levels = [...(sys.levels ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((l) => ({
        id: l.id, abbr: l.abbr, label: l.label, color: l.color, bucket: l.bucket, hotkey: l.hotkey,
      }));
    setEditing({
      id: sys.id,
      name: sys.name,
      slug: sys.slug,
      description: sys.description ?? "",
      isDefault: sys.isDefault,
      levels,
    });
    setEditorOpen(true);
  }

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: "Library", href: "/library" }, { label: "Rating Systems" }]} />
      <PageHeader
        title="Rating Systems"
        meta={`${systems.length} ${systems.length === 1 ? "system" : "systems"}`}
        actions={<Button variant="primary" onClick={openNew}>+ New rating system</Button>}
      />

      {systems.length === 0 ? (
        <Card>
          <EmptyState
            title="No rating systems yet"
            description='Click "+ New rating system" above to define how items are rated during inspections.'
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {systems.map((sys) => {
            const levels = [...(sys.levels ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const confirming = confirmId === sys.id;
            return (
              <Card key={sys.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-ih-fg-1 truncate">{sys.name}</p>
                      {sys.isDefault && (
                        <span className="shrink-0 inline-flex items-center h-4 px-1.5 rounded text-[9px] font-bold uppercase tracking-wide bg-ih-primary-tint text-ih-primary">Default</span>
                      )}
                    </div>
                    {sys.description && (
                      <p className="text-[13px] text-ih-fg-3 mt-1 line-clamp-2">{sys.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(sys)} className="text-[13px] text-ih-primary hover:opacity-80 font-semibold px-1">
                      Edit
                    </button>
                    {!sys.isSeed && (
                      confirming ? (
                        <deleteFetcher.Form method="post" onSubmit={() => setConfirmId(null)}>
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={sys.id} />
                          <button type="submit" className="text-[12px] font-bold text-ih-bad-fg hover:opacity-80 px-1">Confirm?</button>
                        </deleteFetcher.Form>
                      ) : (
                        <button onClick={() => setConfirmId(sys.id)} className="text-[13px] text-ih-fg-4 hover:text-ih-bad-fg font-semibold px-1" title="Delete">Delete</button>
                      )
                    )}
                  </div>
                </div>

                {levels.length > 0 && (
                  <div className="flex items-center flex-wrap gap-1.5 mt-3">
                    {levels.map((l) => (
                      <span
                        key={l.id || l.abbr}
                        className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold ring-1 ${BUCKET_RING[l.bucket] ?? "ring-ih-border-strong/30"}`}
                        style={{ backgroundColor: l.color ? `${l.color}1a` : undefined, color: l.color || undefined }}
                        title={`${l.label} · ${l.bucket}`}
                      >
                        {l.abbr || l.label}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <RatingSystemEditor open={editorOpen} onClose={() => setEditorOpen(false)} system={editing} />
    </div>
  );
}
