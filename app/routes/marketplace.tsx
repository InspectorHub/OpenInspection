import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/marketplace";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Pagination, Banner } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { usePagination } from "~/hooks/usePagination";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";
import { StatutoryUpdateConfirm } from "~/components/marketplace/StatutoryUpdateConfirm";
import { UninstallConfirm } from "~/components/marketplace/UninstallConfirm";
import type { StatutoryUpdateImpact } from "../../server/services/marketplace/statutory-update-impact";

export function meta() {
  return [{ title: m.marketplace_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // NO DEPLOYMENT GATE, and its absence is the design rather than an omission.
  //
  // This loader used to 404 outside saas, on the grounds that a standalone
  // catalogue was empty and nothing could ever reach it. The second half was
  // false the day it was written: `seed-marketplace-libraries.ts` upserts the
  // catalogue from this repository's own fixtures, and its caller
  // (`server/api/admin/admin-content-install.ts`) is gated on role, not on
  // deployment mode. So a self-hosted deployment had a populated catalogue and
  // a locked door in front of it, and could install nothing at all.
  //
  // The line that IS mode-specific runs elsewhere: publishing a catalogue row
  // across workspaces lives under `server/portal/`, which mounts only when
  // `hasPortalIntegrationApi` holds. That is a fact about the topology and not
  // a gate — a self-hosted deployment has no platform on the other end. Nothing
  // here publishes; an operator installs what their own build already ships.
  //
  // The API handlers (`server/api/marketplace.ts`) were always ungated in both
  // modes, which is why this page is all that had to change.
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const page     = url.searchParams.get("page")     ?? "1";
  const pageSize = url.searchParams.get("pageSize") ?? "50";
  try {
    const api = createApi(context, { token });
    const res = await api.marketplace.index.$get({ query: { page, pageSize } });
    if (!res.ok) {
      // A refused request is a FAILED load, not an empty catalogue. This branch
      // said `loadFailed: false`, so an API error rendered the "Marketplace is
      // empty" screen — the exact reading this page's own design set out to
      // avoid, arrived at from the other direction. Observed on 2026-08-30
      // against a database one migration behind: four catalogue rows on disk,
      // a 500 from the query, and a page that said the shelf was bare.
      return { templates: [] as unknown[], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 }, loadFailed: true };
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
  // #106 - an install writes a template into the tenant library.
  const { fetcher: installFetcher, submit: submitInstall, busy: installing } =
    useGuardedSubmit<{ ok: boolean; localTemplateId?: string | null; error?: string }>();
  const [installingId, setInstallingId] = useState<string | null>(null);

  // A statutory package with a newer release is not installed again; it is
  // UPDATED, and an update retires the workspace's current template while the
  // inspections already under way stay on the retired one. Most of them are
  // unaffected, so the confirmation states both numbers before the button
  // rather than leaving the reader to discover either afterwards. It is a
  // component, never `window.confirm`, which can carry neither.
  const [updating, setUpdating] = useState<{ id: string; name: string } | null>(null);
  const impactFetcher = useFetcher<{ ok: boolean; impact: StatutoryUpdateImpact | null }>();
  // Guarded: pressing Update twice would run the update twice, and the second
  // run retires the template the first one just minted.
  const { fetcher: updateFetcher, submit: submitUpdate, busy: applyingUpdate } =
    useGuardedSubmit<{ ok: boolean }>();

  // Un-installing. It reached the UI last of the three verbs and only after an
  // audit: the service method existed, nothing anywhere called it, and the
  // template picker meanwhile shipped copy for a template retired BY an
  // uninstall — a state no workspace could reach. Guarded like the update, and
  // confirmed for the same reason: for a comment pack it removes rows.
  const [uninstalling, setUninstalling] = useState<{ id: string; name: string; kind: string | null } | null>(null);
  const { fetcher: uninstallFetcher, submit: submitUninstall, busy: removing } =
    useGuardedSubmit<{ ok: boolean }>();

  useEffect(() => {
    if (uninstallFetcher.state === "idle" && uninstallFetcher.data?.ok) setUninstalling(null);
  }, [uninstallFetcher.state, uninstallFetcher.data]);

  function reviewStatutoryUpdate(id: string, name: string) {
    setUpdating({ id, name });
    impactFetcher.load(`/resources/statutory-update?libraryId=${encodeURIComponent(id)}`);
  }

  useEffect(() => {
    if (updateFetcher.state === "idle" && updateFetcher.data?.ok) setUpdating(null);
  }, [updateFetcher.state, updateFetcher.data]);

  function handleInstall(id: string) {
    // Track the row only for a call the guard accepted, so a refused click
    // cannot leave a button spinning against no request.
    if (submitInstall({ templateId: id }, { method: "post", action: "/resources/marketplace-install" })) {
      setInstallingId(id);
    }
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
          {/* The SERVER's sentence when it wrote one, and only otherwise the
              generic line. A statutory install refused for want of the
              authority's PDF answers with the revision, the endpoint to upload
              to and where the authority publishes the file — the entire remedy,
              which the generic copy replaced with "Please try again", advice
              that is not merely unhelpful but false: retrying cannot work until
              somebody uploads a file they were never told about. That sentence
              is built in server code and is not in the message catalogue, so it
              arrives in English; a reader who cannot act is worse off than one
              reading an untranslated instruction they can. */}
          {/* `overflow-wrap:anywhere` because the sentence this Banner relays
              is not ours and contains a URL. The statutory refusal ends with
              the authority's own publication link -- a 130-character
              citizensfla.com path with a uuid and a query string -- and a URL
              has no spaces to wrap at. Measured at a 390px viewport: the page
              body scrolled to 457px against a 390px client width, so the whole
              page slid sideways to show one banner. `anywhere` rather than
              `break-all`: it breaks the URL and leaves ordinary prose alone.
              `StatutorySourceRow` reached for `break-all` on the hash and the
              publisher link for the same reason. */}
          <Banner tone="danger" className="[overflow-wrap:anywhere]">
            {installFetcher.data.error || m.marketplace_install_error()}
          </Banner>
          {/* BESIDE the server's sentence, never instead of it. That sentence
              is the remedy and it names an HTTP endpoint, which was the only
              way to supply the file when it was written; there is now a screen,
              and this is the way to it. Offered on every refusal rather than
              matched against the message text — a link a reader did not need
              costs a glance, and a regex over a server-composed paragraph would
              stop matching the first time a word in it changed. */}
          <p className="mt-2 text-[13px]">
            <Link
              to="/settings/statutory-forms"
              className="font-bold text-ih-primary-text hover:underline"
            >
              {m.statutory_source_from_marketplace()}
            </Link>
          </p>
        </div>
      )}

      {uninstallFetcher.data && uninstallFetcher.data.ok === false && (
        <div className="mt-3">
          {/* Said out loud, and it says nothing was changed: a failed uninstall
              that looked like nothing happening would invite a second press. */}
          <Banner tone="danger">{m.marketplace_uninstall_error()}</Banner>
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
              const statutoryUpdate = t.kind === "statutory" && t.hasUpdate === true;
              // `importedSemver` is null for a pack this workspace does not
              // have, INCLUDING one it uninstalled — the marker survives an
              // un-import but the browse query no longer reads it as an
              // install, which is what makes Install the offer on the way back.
              const installed = typeof t.importedSemver === "string";
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
                  <div className="flex items-center gap-2">
                    {statutoryUpdate ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => reviewStatutoryUpdate(t.id, t.name || t.title || "")}
                      >
                        {m.marketplace_review_update()}
                      </Button>
                    ) : reviewUpdate ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`/library/marketplace/${t.id}/update`)}
                      >
                        {m.marketplace_review_update()}
                      </Button>
                    ) : !installed ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleInstall(t.id)}
                        disabled={installing}
                      >
                        {installingId === t.id ? m.marketplace_installing() : m.marketplace_install()}
                      </Button>
                    ) : null}
                    {installed && (
                      <Button
                        variant="danger-link"
                        size="sm"
                        onClick={() => setUninstalling({ id: t.id, name: t.name || t.title || "", kind: t.kind ?? null })}
                        disabled={removing}
                      >
                        {m.marketplace_uninstall()}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
              );
            })}
          </div>

          <StatutoryUpdateConfirm
            open={updating !== null}
            name={updating?.name ?? ""}
            impact={impactFetcher.data?.ok ? impactFetcher.data.impact : null}
            failed={impactFetcher.state === "idle" && impactFetcher.data?.ok === false}
            submitting={applyingUpdate}
            onCancel={() => setUpdating(null)}
            onConfirm={() => {
              if (!updating) return;
              submitUpdate(
                { libraryId: updating.id },
                { method: "post", action: "/resources/statutory-update" },
              );
            }}
          />

          <UninstallConfirm
            open={uninstalling !== null}
            name={uninstalling?.name ?? ""}
            kind={uninstalling?.kind ?? null}
            submitting={removing}
            onCancel={() => setUninstalling(null)}
            onConfirm={() => {
              if (!uninstalling) return;
              submitUninstall(
                { libraryId: uninstalling.id },
                { method: "post", action: "/resources/marketplace-uninstall" },
              );
            }}
          />

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
