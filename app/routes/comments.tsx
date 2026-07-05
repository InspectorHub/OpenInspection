import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/comments";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Pagination } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { usePagination } from "~/hooks/usePagination";

export function meta() {
  return [{ title: "Canned Comments - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const url = new URL(request.url);
    const page     = url.searchParams.get("page")     ?? "1";
    const pageSize = url.searchParams.get("pageSize") ?? "50";
    const api = createApi(context, { token });
    const res = await api.admin.comments.$get({ query: { page, pageSize } });
    const body = res.ok
      ? ((await res.json()) as { data?: unknown[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } })
      : { data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } };
    return {
      comments: (body.data ?? []) as Array<{ id: string; text: string; ratingBucket?: string; section?: string }>,
      meta: body.meta ?? { total: 0, page: 1, pageSize: 50, totalPages: 1 },
    };
  } catch {
    return {
      comments: [] as Array<{ id: string; text: string; ratingBucket?: string; section?: string }>,
      meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
    };
  }
}

const TABS = [
  { id: "all", label: "All" },
  { id: "satisfactory", label: "Satisfactory" },
  { id: "monitor", label: "Monitor" },
  { id: "defect", label: "Defect" },
];

const BUCKET_TONE: Record<string, "sat" | "monitor" | "defect"> = {
  satisfactory: "sat",
  monitor: "monitor",
  defect: "defect",
};

export default function CommentsPage() {
  const { comments, meta } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  const { setPage, setPageSize } = usePagination();

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: "Library", href: "/library" }, { label: "Canned Comments" }]} />
      <PageHeader
        title="Canned Comments"
        meta={`${meta.total} in library`}
        actions={
          <Button variant="primary">+ Add comment</Button>
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {comments.length === 0 ? (
        <Card>
          <EmptyState
            title="No comments yet"
            description='Click "+ Add comment" above to create your first comment snippet.'
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {comments.map((c) => (
              <Card key={c.id} className="p-4">
                <p className="text-[13px] text-ih-fg-3 line-clamp-3">{c.text}</p>
                <div className="flex items-center gap-2 mt-2">
                  {c.ratingBucket && (
                    <Pill tone={BUCKET_TONE[c.ratingBucket] || "gen"}>{c.ratingBucket}</Pill>
                  )}
                  {c.section && <span className="text-[10px] font-bold uppercase tracking-wide text-ih-fg-4">{c.section}</span>}
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
    </div>
  );
}
