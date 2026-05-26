import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/recommendations";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Repair Items - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/recommendations", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { items: (body.data ?? []) as unknown[] };
  } catch {
    return { items: [] };
  }
}

const TABS = [
  { id: "all", label: "All" },
  { id: "safety", label: "Safety" },
  { id: "repair", label: "Repair" },
  { id: "maintenance", label: "Maintenance" },
];

export default function RecommendationsPage() {
  const { items } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Repair Items"
        title="Repair Items"
        meta={`${items.length} in library`}
        actions={
          <Button variant="primary">+ Add item</Button>
        }
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="No repair items yet"
            description='Click "+ Add item" above to create your first repair recommendation.'
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item: any) => (
            <Card key={item.id} className="p-4">
              <p className="text-[13px] font-semibold text-ih-fg-1">{item.title || item.name}</p>
              {item.description && (
                <p className="text-[13px] text-ih-fg-3 mt-1 line-clamp-2">{item.description}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                {item.category && (
                  <Pill tone="gen">{item.category}</Pill>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
