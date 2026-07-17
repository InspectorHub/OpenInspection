import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/comments";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Pagination } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { usePagination } from "~/hooks/usePagination";
import { CommentEditor } from "~/components/CommentEditor";
import type { Severity } from "~/lib/severity";
import { SEVERITIES, SEVERITY_LABEL, isSeverity } from "~/lib/severity";
import { m } from "~/paraglide/messages";

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
  estimateMinCents?: number | null;
  estimateMaxCents?: number | null;
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
  const empty = { comments: [] as LibraryComment[], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 }, contractorTypes: [] as Array<{ id: string; name: string }> };
  try {
    const [commentsRes, contractorTypesRes] = await Promise.all([
      api.admin.comments.$get({ query }),
      api.contractorTypes.index.$get(),
    ]);
    const body = commentsRes.ok
      ? ((await commentsRes.json()) as { data?: LibraryComment[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } })
      : { data: [], meta: empty.meta };
    const contractorTypes = contractorTypesRes.ok
      ? (((await contractorTypesRes.json()) as { data?: Array<{ id: string; name: string }> }).data ?? [])
      : [];
    return {
      comments: body.data ?? [],
      meta: body.meta ?? empty.meta,
      contractorTypes,
    };
  } catch {
    return empty;
  }
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

const SEVERITY_TONE: Record<Severity, "sat" | "monitor" | "defect" | "gen"> = {
  good: "sat",
  marginal: "monitor",
  significant: "defect",
  minor: "gen",
};

export default function CommentsPage() {
  const { comments, meta, contractorTypes } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = isSeverity(searchParams.get("severity") ?? "") ? (searchParams.get("severity") as Severity) : "all";
  const { setPage, setPageSize } = usePagination();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryComment | null>(null);

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
      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.comments_heading() }]} />
      <PageHeader
        title={m.comments_heading()}
        meta={m.comments_meta({ count: meta.total })}
        actions={
          <Button variant="primary" onClick={() => { setEditing(null); setEditorOpen(true); }}>{m.comments_add()}</Button>
        }
      />

      <TabStrip tabs={getTabs()} activeId={activeTab} onChange={setActiveTab} />

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
                <p className="text-[13px] text-ih-fg-3 line-clamp-3">{c.text}</p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="flex items-center gap-2">
                    {c.severity && (
                      <Pill tone={SEVERITY_TONE[c.severity]}>{SEVERITY_LABEL[c.severity]}</Pill>
                    )}
                    {c.section && <span className="text-[10px] font-bold uppercase tracking-wide text-ih-fg-4">{c.section}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setEditing(c); setEditorOpen(true); }}
                    className="text-[11px] font-bold text-ih-primary hover:text-ih-primary-600"
                  >
                    {m.common_edit()}
                  </button>
                </div>
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
    </div>
  );
}
