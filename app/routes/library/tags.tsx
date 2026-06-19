import { useLoaderData } from "react-router";
import type { Route } from "./+types/tags";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";
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
    <div className="space-y-[18px]">
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
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Name</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Color</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Used</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ih-border">
              {tags.map((tag) => (
                <tr key={tag.id} className="hover:bg-ih-bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ih-fg-1">
                      {tag.color && (
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      )}
                      {tag.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ih-fg-3">{tag.color || "--"}</td>
                  <td className="px-4 py-3 text-[13px] text-ih-fg-3">{tag.count ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
