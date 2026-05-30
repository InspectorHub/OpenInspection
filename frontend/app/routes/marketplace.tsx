import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/marketplace";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Pagination } from "@core/shared-ui";
import { usePagination } from "~/hooks/usePagination";

export function meta() {
  return [{ title: "Marketplace - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const page     = url.searchParams.get("page")     ?? "1";
  const pageSize = url.searchParams.get("pageSize") ?? "50";
  try {
    const api = createApi(context, { token });
    const res = await api.marketplace.index.$get({ query: { page, pageSize } });
    if (!res.ok) {
      return { templates: [] as unknown[], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } };
    }
    const body = await res.json() as { data?: unknown[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } };
    return {
      templates: (body.data ?? []) as unknown[],
      meta: body.meta ?? { total: 0, page: 1, pageSize: 50, totalPages: 1 },
    };
  } catch {
    return {
      templates: [] as unknown[],
      meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
    };
  }
}

const TABS = [
  { id: "all", label: "All" },
  { id: "templates", label: "Templates" },
  { id: "comments", label: "Comments" },
  { id: "agreements", label: "Agreements" },
];

export default function MarketplacePage() {
  const { templates, meta } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  const { setPage, setPageSize } = usePagination();

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Marketplace"
        title="Marketplace"
        meta={`${meta.total} available`}
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((raw) => {
              const t = raw as { id: string; name?: string; title?: string; description?: string; category?: string; author?: string };
              return (
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
              );
            })}
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
