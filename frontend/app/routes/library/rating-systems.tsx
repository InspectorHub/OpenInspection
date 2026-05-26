import { useLoaderData } from "react-router";
import type { Route } from "./+types/rating-systems";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Rating Systems - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/rating-systems", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { systems: (body.data ?? []) as unknown[] };
  } catch {
    return { systems: [] };
  }
}

export default function RatingSystemsPage() {
  const { systems } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Rating Systems"
        title="Rating Systems"
        meta={`${systems.length} systems`}
        actions={
          <Button variant="primary">+ New rating system</Button>
        }
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
          {systems.map((sys: any) => (
            <Card key={sys.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-ih-fg-1">{sys.name}</p>
                  {sys.description && (
                    <p className="text-[13px] text-ih-fg-3 mt-1 line-clamp-2">{sys.description}</p>
                  )}
                </div>
                <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold shrink-0 ml-4">
                  Edit
                </button>
              </div>
              {sys.ratings && Array.isArray(sys.ratings) && (
                <div className="flex items-center gap-1.5 mt-3">
                  {sys.ratings.map((r: any, idx: number) => (
                    <span
                      key={idx}
                      className="inline-flex items-center h-6 px-2 rounded text-[11px] font-bold"
                      style={{
                        backgroundColor: r.color ? `${r.color}20` : undefined,
                        color: r.color || undefined,
                      }}
                    >
                      {r.label || r.name}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
