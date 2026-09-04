import { useEffect, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/tags";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState, Table } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";
import { TagEditorModal, type EditableTag } from "~/components/library/TagEditorModal";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { isAdminRole } from "~/lib/access";

export function meta() {
  return [{ title: m.library_tags_meta_title() }];
}

type TagRow = { id: string; name: string; color?: string | null; count?: number; isSeed?: boolean };

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // The caller's role decides whether EDIT is offered at all. `PUT /api/tags/{id}`
  // is owner/manager while `POST /api/tags` also allows an inspector, so an Edit
  // control shown to an inspector is a button whose only outcome is 403.
  let role: string | undefined;
  try {
    const ctxRes = await api.sessionContext.context.$get();
    if (ctxRes.ok) {
      const b = (await ctxRes.json()) as { data?: { user?: { role?: string } } };
      role = b.data?.user?.role;
    }
  } catch {
    role = undefined;
  }

  try {
    const res = await api.tags.index.$get();
    if (!res.ok) throw new Error(`tags ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return { tags: (body.data ?? []) as TagRow[], canManage: isAdminRole(role), loadFailed: false };
  } catch {
    // `canManage` comes from the role resolved ABOVE this block, so a failed
    // list does not also downgrade what the page says the caller may do.
    return { tags: [] as TagRow[], canManage: isAdminRole(role), loadFailed: true };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();

  const name = String(form.get("name") ?? "").trim();
  // An empty select means "no colour". The field is OPTIONAL on create and
  // NULLABLE on update, and those are different: create omits it, update sends
  // null to clear one that is already set.
  const raw = String(form.get("color") ?? "").trim();
  const id = form.get("id");

  try {
    if (typeof id === "string" && id) {
      const res = await api.tags[":id"].$put({
        param: { id },
        json: { name, color: raw ? raw : null },
      });
      if (!res.ok) return { ok: false as const, error: await apiError(res) };
      return { ok: true as const };
    }
    const res = await api.tags.index.$post({ json: { name, ...(raw ? { color: raw } : {}) } });
    if (!res.ok) return { ok: false as const, error: await apiError(res) };
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Connection error. Please try again." };
  }
}

/** The API's own words — "A tag named 'x' already exists" is worth showing. */
async function apiError(res: { json: () => Promise<unknown>; status: number }): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const msg = typeof body?.error === "string" ? body.error : body?.error?.message;
  return msg || `Request failed (${res.status})`;
}

export default function TagsPage() {
  const { tags, canManage, loadFailed } = useLoaderData<typeof loader>();
  // `null` is closed; `{ tag: null }` is create; `{ tag }` is edit that row.
  const [editing, setEditing] = useState<{ tag: EditableTag | null } | null>(null);
  const { submit, fetcher, busy } = useGuardedSubmit<{ ok?: boolean; error?: string }>();

  // A settled success closes the dialog; a failure keeps it open with the
  // API's own message, because "that name is taken" is worth reading.
  //
  // In an effect, never during render: closing the dialog IS a state change,
  // and doing it while rendering is the bug this codebase already grew once.
  // `handled` makes each reply act once, so a later unrelated render cannot
  // re-close a dialog the person has since reopened.
  const reply = fetcher.state === "idle" ? fetcher.data : undefined;
  const handled = useRef<typeof reply>(undefined);
  useEffect(() => {
    if (!reply || handled.current === reply) return;
    handled.current = reply;
    if (reply.ok) setEditing(null);
  }, [reply]);

  function save(form: HTMLFormElement) {
    const fd = new FormData(form);
    const payload: Record<string, string> = {
      name: String(fd.get("name") ?? ""),
      color: String(fd.get("color") ?? ""),
    };
    if (editing?.tag) payload.id = editing.tag.id;
    submit(payload, { method: "post" });
  }

  return (
    <div className="space-y-ih-list">
      {/* IA-118 — an empty list here is a conclusion; say when it is not a real one. */}
      {loadFailed && <LoadFailedNotice />}

      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.library_tags_heading() }]} />
      <PageHeader
        title={m.library_tags_heading()}
        meta={m.library_tags_meta({ count: tags.length })}
        actions={
          <Button variant="primary" onClick={() => setEditing({ tag: null })}>
            {m.library_tags_add()}
          </Button>
        }
      />

      {tags.length === 0 ? (
        <Card>
          <EmptyState
            title={m.library_tags_empty_title()}
            description={m.library_tags_empty_desc()}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table<{ id: string; name: string; color?: string | null; count?: number }>
            rows={tags}
            getRowKey={(tag) => tag.id}
            columns={[
              {
                label: m.library_tags_col_name(),
                cell: (tag) => (
                  <span className="inline-flex items-center gap-2 font-semibold text-ih-fg-1">
                    {tag.color && (
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                    )}
                    {tag.name}
                  </span>
                ),
              },
              { label: m.library_tags_col_color(), cell: (tag) => <span className="text-ih-fg-3">{tag.color || "--"}</span> },
              { label: m.library_tags_col_used(), cell: (tag) => <span className="text-ih-fg-3">{tag.count ?? 0}</span> },
              {
                label: m.library_tags_col_actions(),
                align: "right",
                // Rendered only for owner/manager: `PUT /api/tags/{id}` refuses
                // an inspector, and a control whose only outcome is 403 is the
                // same defect this page had before, one status code later.
                cell: (tag) =>
                  canManage ? (
                    <button
                      type="button"
                      onClick={() => setEditing({ tag })}
                      className="text-[13px] text-ih-primary-text hover:opacity-80 font-semibold"
                    >
                      {m.library_tags_edit_action()}
                    </button>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}

      {!canManage && tags.length > 0 && (
        <p className="text-[12px] text-ih-fg-3">{m.library_tags_readonly_note()}</p>
      )}

      <TagEditorModal
        open={editing !== null}
        tag={editing?.tag ?? null}
        busy={busy}
        error={reply?.ok === false ? reply.error : undefined}
        onClose={() => setEditing(null)}
        onSubmit={save}
      />
    </div>
  );
}
