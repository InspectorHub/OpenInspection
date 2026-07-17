import { useLoaderData } from "react-router";
import type { Route } from "./+types/tags";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState, Table } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.library_tags_meta_title() }];
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
      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.library_tags_heading() }]} />
      <PageHeader
        title={m.library_tags_heading()}
        meta={m.library_tags_meta({ count: tags.length })}
        actions={
          <Button variant="primary">{m.library_tags_add()}</Button>
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
                cell: () => (
                  <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">
                    {m.common_edit()}
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
