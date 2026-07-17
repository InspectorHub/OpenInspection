import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/defect-categories";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { DefectCategoryEditor, type EditorDefectCategory } from "~/components/DefectCategoryEditor";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.library_defect_meta_title() }];
}

type DefectCategory = { id: string; name: string; color: string; drivesSummary: boolean; sortOrder: number; isSeed: boolean };

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.defectCategories["defect-categories"].$get({}, { headers: { "x-token-relay": "1" } });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { categories: (body.data ?? []) as DefectCategory[] };
  } catch {
    return { categories: [] as DefectCategory[] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  const api = createApi(context, { token });

  if (intent === "delete") {
    const id = String(form.get("id") || "");
    const res = await api.defectCategories["defect-categories"][":id"].$delete(
      { param: { id } },
      { headers: { "x-token-relay": "1" } },
    );
    return { ok: res.ok, intent: "delete" as const };
  }

  return { ok: false };
}

export default function DefectCategoriesPage() {
  const { categories } = useLoaderData<typeof loader>();
  const deleteFetcher = useFetcher();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EditorDefectCategory | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(cat: DefectCategory) {
    setEditing({
      id: cat.id, name: cat.name, color: cat.color,
      drivesSummary: cat.drivesSummary, sortOrder: cat.sortOrder, isSeed: cat.isSeed,
    });
    setEditorOpen(true);
  }

  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.library_defect_heading() }]} />
      <PageHeader
        title={m.library_defect_heading()}
        meta={categories.length === 1 ? m.library_defect_meta_one({ count: categories.length }) : m.library_defect_meta_other({ count: categories.length })}
        actions={<Button variant="primary" onClick={openNew}>{m.library_defect_new()}</Button>}
      />

      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            title={m.library_defect_empty_title()}
            description={m.library_defect_empty_desc()}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sorted.map((cat) => {
            const confirming = confirmId === cat.id;
            return (
              <Card key={cat.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    {/* User-picked category color (data, not a design token) —
                        same inline-style exemption as RatingSystemEditor.tsx. */}
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: cat.color }}
                    />
                    <p className="text-[13px] font-semibold text-ih-fg-1 truncate">{cat.name}</p>
                    {cat.drivesSummary && (
                      <span className="shrink-0 inline-flex items-center h-4 px-1.5 rounded text-[9px] font-bold uppercase tracking-wide bg-ih-primary-tint text-ih-primary">{m.library_defect_summary_badge()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(cat)} className="text-[13px] text-ih-primary hover:opacity-80 font-semibold px-1">
                      {m.common_edit()}
                    </button>
                    {!cat.isSeed && (
                      confirming ? (
                        <deleteFetcher.Form method="post" onSubmit={() => setConfirmId(null)}>
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={cat.id} />
                          <button type="submit" className="text-[12px] font-bold text-ih-bad-fg hover:opacity-80 px-1">{m.library_action_confirm()}</button>
                        </deleteFetcher.Form>
                      ) : (
                        <button onClick={() => setConfirmId(cat.id)} className="text-[13px] text-ih-fg-4 hover:text-ih-bad-fg font-semibold px-1" title={m.common_delete()}>{m.common_delete()}</button>
                      )
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <DefectCategoryEditor open={editorOpen} onClose={() => setEditorOpen(false)} category={editing} />
    </div>
  );
}
