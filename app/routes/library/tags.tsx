import { useLoaderData } from "react-router";
import type { Route } from "./+types/tags";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState, Table } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";

export function meta() {
  return [{ title: "Tags - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.tags.index.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { tags: (body.data ?? []) as Array<{ id: string; name: string; color?: string | null; count?: number }> };
  } catch {
    return { tags: [] };
  }
}

export default function TagsPage() {
  const { tags } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: "Library", href: "/library" }, { label: "Tags" }]} />
      <PageHeader
        title="Tags"
        meta={`${tags.length} tags`}
        actions={
          <Button variant="primary">+ Add tag</Button>
        }
      />

      {tags.length === 0 ? (
        <Card>
          <EmptyState
            title="No tags yet"
            description='Click "+ Add tag" above to organize your library with tags.'
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table<{ id: string; name: string; color?: string | null; count?: number }>
            rows={tags}
            getRowKey={(tag) => tag.id}
            columns={[
              {
                label: "Name",
                cell: (tag) => (
                  <span className="inline-flex items-center gap-2 font-semibold text-ih-fg-1">
                    {tag.color && (
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                    )}
                    {tag.name}
                  </span>
                ),
              },
              { label: "Color", cell: (tag) => <span className="text-ih-fg-3">{tag.color || "--"}</span> },
              { label: "Used", cell: (tag) => <span className="text-ih-fg-3">{tag.count ?? 0}</span> },
              {
                label: "Actions",
                align: "right",
                cell: () => (
                  <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">
                    Edit
                  </button>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
