import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/marketplace";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { getCloudflareEnv } from "~/lib/load-context";
import { getDeploymentProfile } from "../../server/lib/deployment-profile";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Pagination, Banner } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { usePagination } from "~/hooks/usePagination";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";

export function meta() {
  return [{ title: m.marketplace_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // SaaS-only surface. In standalone the catalogue is empty and there is no
  // path by which anything reaches it, so a 404 is the honest answer — the
  // alternative is the "Marketplace is empty" screen this spec exists because
  // of. Checked before auth: the page does not exist in this mode, which is
  // true regardless of who is asking.
  //
  // The API handlers (`server/api/marketplace.ts`) are deliberately left
  // ungated — harmless once nothing links to them, and the marketplace
  // unification work (OI #293) reuses them.
  //
  // Read through the capability seam rather than the raw deployment-mode var
  // (see server/lib/deployment-profile.ts). This route and the #308 gate landed
  // in the same round, and the first draft branched on the mode directly, which
  // is the exact pattern that gate now forbids. The capability states what is
  // actually being asked — does this surface exist here — instead of naming the
  // deployment that happens to imply it today.
  if (!getDeploymentProfile(getCloudflareEnv(context)).hasContentMarketplace) {
    throw new Response("Not Found", { status: 404 });
  }
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const page     = url.searchParams.get("page")     ?? "1";
  const pageSize = url.searchParams.get("pageSize") ?? "50";
  try {
    const api = createApi(context, { token });
    const res = await api.marketplace.index.$get({ query: { page, pageSize } });
    if (!res.ok) {
      return { templates: [] as unknown[], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 }, loadFailed: false };
    }
    const body = await res.json() as { data?: unknown[]; meta?: { total: number; page: number; pageSize: number; totalPages: number } };
    return {
      templates: (body.data ?? []) as unknown[],
      meta: body.meta ?? { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      loadFailed: false,
    };
  } catch {
    return {
      templates: [] as unknown[],
      meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      loadFailed: true,
    };
  }
}

// A function (not a module const) so `m.*()` resolves inside the per-request
// paraglide locale scope, not once at import time.
function getTabs() {
  return [
    { id: "all", label: m.marketplace_tab_all() },
    { id: "templates", label: m.marketplace_tab_templates() },
    { id: "comments", label: m.marketplace_tab_comments() },
    { id: "agreements", label: m.marketplace_tab_agreements() },
  ];
}

export default function MarketplacePage() {
  const { templates, meta, loadFailed } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  const { setPage, setPageSize } = usePagination();

  // IA-39 — Install now actually installs. One fetcher; the submitting card is
  // tracked so only its button shows the pending state. On success we jump to
  // the freshly imported template in the library.
  const navigate = useNavigate();
  const installFetcher = useFetcher<{ ok: boolean; localTemplateId?: string | null; error?: string }>();
  const [installingId, setInstallingId] = useState<string | null>(null);

  function handleInstall(id: string) {
    setInstallingId(id);
    installFetcher.submit({ templateId: id }, { method: "post", action: "/resources/marketplace-install" });
  }

  useEffect(() => {
    if (installFetcher.state !== "idle" || !installFetcher.data) return;
    if (installFetcher.data.ok && installFetcher.data.localTemplateId) {
      navigate(`/library/templates?imported=${installFetcher.data.localTemplateId}`);
    }
    setInstallingId(null);
  }, [installFetcher.state, installFetcher.data, navigate]);

  return (
    <div className="space-y-ih-list">
      {/* IA-118 — an empty list here is a conclusion; say when it is not a real one. */}
      {loadFailed && <LoadFailedNotice />}

      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.marketplace_heading() }]} />
      <PageHeader
        title={m.marketplace_heading()}
        meta={m.marketplace_meta({ count: meta.total })}
      />

      <TabStrip tabs={getTabs()} activeId={activeTab} onChange={setActiveTab} />

      {installFetcher.data && installFetcher.data.ok === false && (
        <div className="mt-3">
          <Banner tone="danger">{m.marketplace_install_error()}</Banner>
        </div>
      )}

      {templates.length === 0 ? (
        <Card>
          <EmptyState
            title={m.marketplace_empty_title()}
            description={m.marketplace_empty_desc()}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((raw) => {
              const t = raw as unknown as { id: string; name?: string; title?: string; description?: string; category?: string; author?: string; kind?: string; hasUpdate?: boolean; importedSemver?: string | null };
              // #348 — an imported comment pack with a newer release does not
              // get an Install button, because installing is not what is on
              // offer: the review page shows what an update would overwrite
              // first. Templates keep their old path — updating one mints a
              // second local copy and destroys nothing.
              const reviewUpdate = t.kind === "comments" && t.hasUpdate === true;
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
                      <span className="text-[11px] text-ih-fg-3">{t.author}</span>
                    )}
                  </div>
                  {reviewUpdate ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/library/marketplace/${t.id}/update`)}
                    >
                      {m.marketplace_review_update()}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleInstall(t.id)}
                      disabled={installFetcher.state !== "idle"}
                    >
                      {installingId === t.id ? m.marketplace_installing() : m.marketplace_install()}
                    </Button>
                  )}
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
