import { useEffect, useState } from "react";
import { useLoaderData, useRevalidator, useFetcher } from "react-router";
import type { Route } from "./+types/agreements";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState, Banner } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { TemplateRow } from "~/components/agreements/AgreementRows";
import { AgreementTemplateModal } from "~/components/agreements/AgreementTemplateModal";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import type { AgreementTemplateSaveResult } from "~/routes/resources/agreement-templates";
import { AGREEMENT_TEMPLATES_ACTION } from "~/routes/resources/agreement-templates";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";

/**
 * Library → Agreements. Reusable agreement TEMPLATES, and nothing else.
 *
 * IA-65 — this page used to carry a second "Signing" tab listing every live
 * signing request in the tenant, with the remind / copy-link / pre-sign actions
 * on it. A signing request is not a library asset: it belongs to one
 * inspection, has a state, and someone is waiting on it. Chasing one meant
 * leaving that inspection to find it again in a tenant-wide table. Those live
 * envelopes now render on the inspection itself (`SigningRequests` in the
 * workspace); the Library keeps what is genuinely reusable.
 *
 * #67 — the page was READ-ONLY, and not by design. "+ New agreement" was a
 * `<Button variant="primary">` with no `onClick`, and the per-row "Edit" was a
 * bare `<button>` with none either, while `POST`/`PUT`/`DELETE /agreements`
 * had been sitting on the server unused the whole time. Authoring lives in
 * `AgreementTemplateModal`; the writes go through
 * `/resources/agreement-templates`, because a client `fetch('/api/...')` in
 * this repository carries no JWT.
 */

export function meta() {
  return [{ title: m.library_agreements_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const tplRes = await api.admin.agreements.$get();
    const tplBody = tplRes.ok ? ((await tplRes.json()) as Record<string, unknown>) : { data: [] };
    if (!tplRes.ok) throw new Error(`agreements ${tplRes.status}`);
    return {
      templates: (tplBody.data ?? []) as Array<{ id: string; name?: string; updatedAt?: string; createdAt?: string }>,
      loadFailed: false,
    };
  } catch {
    return { templates: [] as Array<{ id: string; name?: string; updatedAt?: string; createdAt?: string }>, loadFailed: true };
  }
}

type TemplateSummary = { id: string; name?: string; updatedAt?: string; createdAt?: string };

export default function AgreementsPage() {
  const { templates, loadFailed } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const deleteFetcher = useFetcher<AgreementTemplateSaveResult>();

  /** `undefined` = closed; `null` = creating; a string = editing that id. */
  const [editorFor, setEditorFor] = useState<string | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);

  const deleteBusy = deleteFetcher.state !== "idle";
  const deleteError =
    deleteFetcher.state === "idle" && deleteFetcher.data && !deleteFetcher.data.ok
      ? deleteFetcher.data.error
      : null;

  // Re-read the list only once the delete has actually SUCCEEDED. Revalidating
  // straight after `submit()` races the request and can repaint the row that
  // was just removed, or remove one the server refused to delete.
  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.ok) void revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const closeEditor = () => setEditorFor(undefined);
  const afterSave = () => {
    setEditorFor(undefined);
    // The list is a loader result; re-read it rather than patching a copy.
    void revalidator.revalidate();
  };

  return (
    <div className="space-y-ih-list">
      {/* IA-118 — an empty list here is a conclusion; say when it is not a real one. */}
      {loadFailed && <LoadFailedNotice />}
      {deleteError && <Banner tone="danger">{deleteError}</Banner>}

      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.library_agreements_heading() }]} />
      <PageHeader
        title={m.library_agreements_heading()}
        meta={m.library_agreements_meta_templates({ templates: templates.length })}
        actions={
          <Button variant="primary" onClick={() => setEditorFor(null)}>
            {m.library_agreements_new()}
          </Button>
        }
      />

      {templates.length === 0 ? (
        <Card>
          <EmptyState
            title={m.library_agreements_empty_templates_title()}
            description={m.library_agreements_empty_templates_desc()}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* TODO(ds-table): not migrated to the shared <Table> primitive. */}
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">{m.library_agreements_col_title()}</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">{m.library_agreements_col_last_updated()}</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">{m.library_agreements_col_status()}</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3 text-right">{m.library_agreements_col_actions()}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ih-border">
              {templates.map((t) => (
                <TemplateRow key={t.id} t={t} onEdit={setEditorFor} onDelete={setDeleting} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AgreementTemplateModal
        open={editorFor !== undefined}
        templateId={editorFor ?? null}
        onClose={closeEditor}
        onSaved={afterSave}
      />

      {/* Names the template AND what goes with it. Deleting one is not the same
          as deleting a row: services and booking pages that attach this
          agreement stop attaching anything, and there is no undo. Agreements
          ALREADY SENT keep their own signed copy of the text
          (`agreement_requests.content_snapshot`), so what a client signed is
          not rewritten by this — saying so is the difference between a scary
          dialog and an informative one. */}
      <ConfirmDialog
        open={!!deleting}
        title={m.library_agreements_delete_title()}
        message={m.library_agreements_delete_message({ name: deleting?.name || m.agreement_row_untitled() })}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          deleteFetcher.submit(
            { intent: "delete", id: deleting.id },
            { method: "post", action: AGREEMENT_TEMPLATES_ACTION },
          );
          setDeleting(null);
        }}
      />
    </div>
  );
}
