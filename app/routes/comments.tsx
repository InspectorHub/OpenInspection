import { useState } from "react";
import { useLoaderData, useSearchParams, useFetcher } from "react-router";
import type { Route } from "./+types/comments";
import { useDisplayTimeZone } from "~/hooks/useSessionContext";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Pagination, Checkbox } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { usePagination } from "~/hooks/usePagination";
import { CommentEditor } from "~/components/CommentEditor";
import { EntityAuditTrail } from "~/components/audit/EntityAuditTrail";
import type { Severity } from "~/lib/severity";
import { SEVERITIES, SEVERITY_LABEL, isSeverity } from "~/lib/severity";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";

export function meta() {
  return [{ title: m.comments_meta_title() }];
}

export interface LibraryComment {
  id: string;
  text: string;
  severity?: Severity | null;
  section?: string | null;
  itemLabel?: string | null;
  repairSummary?: string | null;
  recommendedContractorTypeId?: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const page     = url.searchParams.get("page")     ?? "1";
  const pageSize = url.searchParams.get("pageSize") ?? "50";
  const severityParam = url.searchParams.get("severity") ?? "";
  const query: Record<string, string> = { page, pageSize };
  if (isSeverity(severityParam)) query.severity = severityParam;
  const api = createApi(context, { token });
  const empty = { comments: [] as LibraryComment[], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 }, contractorTypes: [] as Array<{ id: string; name: string }>, loadFailed: true };
  try {
    const [commentsRes, contractorTypesRes] = await Promise.all([
      api.admin.comments.$get({ query }),
      api.contractorTypes.index.$get(),
    ]);
    if (!commentsRes.ok) throw new Error(`comments ${commentsRes.status}`);
    const body = (await commentsRes.json()) as { data?: LibraryComment[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } };
    const contractorTypes = contractorTypesRes.ok
      ? (((await contractorTypesRes.json()) as { data?: Array<{ id: string; name: string }> }).data ?? [])
      : [];
    return {
      comments: body.data ?? [],
      meta: body.meta ?? empty.meta,
      contractorTypes,
      loadFailed: false,
    };
  } catch {
    return empty;
  }
}

/**
 * #291 — the library had create, read and update but no delete at any surface,
 * so 2,774 rows could only ever accumulate. The endpoint already existed and had
 * zero callers; this is the caller.
 *
 * Delete is safe to offer because an inspection snapshots the comment TEXT and
 * holds no reference to the library row — pinned by
 * `tests/unit/comments/comment-delete-isolation.spec.ts`, which is what stops a
 * future change to that relationship from reaching a published report.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const del = async (id: string) => {
    const res = await api.admin.comments[":id"].$delete({ param: { id } });
    return res.ok;
  };

  try {
    if (intent === "delete") {
      const id = String(form.get("id") ?? "");
      if (!id) return { ok: false, intent, deleted: 0 };
      return { ok: await del(id), intent, deleted: 1 };
    }
    if (intent === "delete-many") {
      // No bulk endpoint exists and adding one would leave two delete paths on
      // one table. Sequential keeps the audit rows in a readable order and the
      // page sizes here are bounded by the paginator.
      const ids = String(form.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      let deleted = 0;
      for (const id of ids) if (await del(id)) deleted += 1;
      return { ok: deleted === ids.length, intent, deleted };
    }
  } catch {
    return { ok: false, intent, deleted: 0 };
  }
  return { ok: false, intent, deleted: 0 };
}

// Module D — severity tabs (single canonical vocabulary shared with rating
// levels, module F). The "all" tab clears the filter; the rest map straight
// onto the `severity` query param the loader forwards to the API.
// A function (not a module const) so `m.*()` resolves inside the per-request
// paraglide locale scope, not once at import time.
function getTabs() {
  return [
    { id: "all", label: m.comments_tab_all() },
    ...SEVERITIES.map((s) => ({ id: s, label: SEVERITY_LABEL[s] })),
  ];
}

/** Enough of the wording to recognise the row, short enough to read in a dialog. */
const preview = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);

const SEVERITY_TONE: Record<Severity, "sat" | "monitor" | "defect" | "gen"> = {
  good: "sat",
  marginal: "monitor",
  significant: "defect",
  minor: "gen",
};

export default function CommentsPage() {
  const { comments, meta, contractorTypes, loadFailed } = useLoaderData<typeof loader>();
  const displayTz = useDisplayTimeZone();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = isSeverity(searchParams.get("severity") ?? "") ? (searchParams.get("severity") as Severity) : "all";
  const { setPage, setPageSize } = usePagination();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryComment | null>(null);
  const deleteFetcher = useFetcher<typeof action>();
  const [pendingDelete, setPendingDelete] = useState<LibraryComment | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // A selection means ids on THIS page of THIS filter. Everything downstream
  // reads `selectedComments`, which intersects with what is currently listed —
  // so a page change, a filter change or a completed delete drops those rows
  // from the selection by construction. Clearing the array in an effect instead
  // would race the first click after mount.
  const selectedComments = comments.filter((c) => selected.includes(c.id));
  const soleSelected = selectedComments.length === 1 ? selectedComments[0] : null;
  const busy = deleteFetcher.state !== "idle";
  const deleteFailed = deleteFetcher.state === "idle" && deleteFetcher.data?.ok === false;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function setActiveTab(id: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === "all") next.delete("severity"); else next.set("severity", id);
      next.delete("page"); // reset to page 1 when the filter changes
      return next;
    });
  }

  return (
    <div className="space-y-ih-list">
      {/* IA-118 — an empty list here is a conclusion; say when it is not a real one. */}
      {loadFailed && <LoadFailedNotice />}

      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.comments_heading() }]} />
      <PageHeader
        title={m.comments_heading()}
        meta={m.comments_meta({ count: meta.total })}
        actions={
          <Button variant="primary" onClick={() => { setEditing(null); setEditorOpen(true); }}>{m.comments_add()}</Button>
        }
      />

      <TabStrip tabs={getTabs()} activeId={activeTab} onChange={setActiveTab} />

      {deleteFailed && (
        <p role="alert" className="text-[12px] font-semibold text-ih-bad-fg">{m.comments_delete_failed()}</p>
      )}

      {comments.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Checkbox
              bare
              id="comments-select-all"
              checked={selectedComments.length === comments.length && comments.length > 0}
              onChange={(e) => setSelected(e.target.checked ? comments.map((c) => c.id) : [])}
            />
            <label htmlFor="comments-select-all" className="text-[13px] text-ih-fg-2 cursor-pointer">
              {m.comments_select_all()}
            </label>
          </div>
          {selectedComments.length > 0 && (
            <>
              <Button variant="danger" onClick={() => setBulkConfirm(true)} disabled={busy}>
                {m.comments_delete_selected({ count: selectedComments.length })}
              </Button>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-[12px] font-bold text-ih-fg-3 hover:text-ih-fg-1"
              >
                {m.comments_clear_selection()}
              </button>
            </>
          )}
        </div>
      )}

      {comments.length === 0 ? (
        <Card>
          <EmptyState
            title={m.comments_empty_title()}
            description={m.comments_empty_desc()}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {comments.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    bare
                    className="mt-0.5 shrink-0"
                    aria-label={m.comments_select_label()}
                    checked={selected.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <p className="text-[13px] text-ih-fg-3 line-clamp-3">{c.text}</p>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="flex items-center gap-2">
                    {c.severity && (
                      <Pill tone={SEVERITY_TONE[c.severity]}>{SEVERITY_LABEL[c.severity]}</Pill>
                    )}
                    {c.section && <span className="text-[10px] font-bold uppercase tracking-wide text-ih-fg-3">{c.section}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { setEditing(c); setEditorOpen(true); }}
                      className="text-[11px] font-bold text-ih-primary-text hover:text-ih-primary-600"
                    >
                      {m.common_edit()}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(c)}
                      className="text-[11px] font-bold text-ih-bad-fg hover:underline"
                    >
                      {m.common_delete()}
                    </button>
                  </div>
                </div>
                <EntityAuditTrail entityId={c.id} timeZone={displayTz} />
              </Card>
            ))}
          </div>

          <Pagination
            page={meta.page}
            pageSize={meta.pageSize}
            total={meta.total}
            totalPages={meta.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      <CommentEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        comment={editing}
        contractorTypes={contractorTypes}
      />

      {/* A library page is dozens of near-identical rows, so the confirmation
          quotes the wording rather than asking "delete this comment?". */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={m.comments_delete_title()}
        message={pendingDelete ? m.comments_delete_message({ text: preview(pendingDelete.text) }) : ""}
        busy={busy}
        onConfirm={() => {
          if (pendingDelete) deleteFetcher.submit({ intent: "delete", id: pendingDelete.id }, { method: "POST" });
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {/* One selected row is not a bulk operation: name it, the way the row
          control does. It also keeps the count message honestly plural. */}
      <ConfirmDialog
        open={bulkConfirm}
        title={soleSelected ? m.comments_delete_title() : m.comments_delete_many_title()}
        message={soleSelected
          ? m.comments_delete_message({ text: preview(soleSelected.text) })
          : m.comments_delete_many_message({ count: selectedComments.length })}
        busy={busy}
        onConfirm={() => {
          deleteFetcher.submit(
            { intent: "delete-many", ids: selectedComments.map((c) => c.id).join(",") },
            { method: "POST" },
          );
          setBulkConfirm(false);
          setSelected([]);
        }}
        onCancel={() => setBulkConfirm(false)}
      />
    </div>
  );
}
