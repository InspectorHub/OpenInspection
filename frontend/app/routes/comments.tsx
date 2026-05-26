import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/comments";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Comments Library - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/comments", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { comments: (body.data ?? []) as unknown[] };
  } catch {
    return { comments: [] };
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
  const { comments } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Comments"
        title="Comments Library"
        meta={`${comments.length} in library`}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {comments.map((c: any) => (
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
      )}
    </div>
  );
}
