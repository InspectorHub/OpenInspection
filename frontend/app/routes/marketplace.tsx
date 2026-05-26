import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/marketplace";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";

export function meta() {
  return [{ title: "Marketplace - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/marketplace/templates", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { templates: (body.data ?? []) as unknown[] };
  } catch {
    return { templates: [] };
  }
}

const TABS = [
  { id: "all", label: "All" },
  { id: "templates", label: "Templates" },
  { id: "comments", label: "Comments" },
  { id: "agreements", label: "Agreements" },
];

export default function MarketplacePage() {
  const { templates } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Marketplace"
        title="Marketplace"
        meta={`${templates.length} available`}
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {templates.length === 0 ? (
        <Card>
          <EmptyState
            title="Marketplace is empty"
            description="Community templates and content packs will appear here."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t: any) => (
            <Card key={t.id} className="p-4">
              <p className="text-[13px] font-semibold text-ih-fg-1">{t.name || t.title}</p>
              {t.description && (
                <p className="text-[13px] text-ih-fg-3 mt-1 line-clamp-2">{t.description}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  {t.category && (
                    <Pill tone="gen">{t.category}</Pill>
                  )}
                  {t.author && (
                    <span className="text-[11px] text-ih-fg-4">{t.author}</span>
                  )}
                </div>
                <Button variant="primary" size="sm">Install</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
