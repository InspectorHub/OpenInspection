import { useLoaderData } from "react-router";
import type { Route } from "./+types/agreements";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Button, EmptyState } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { TemplateRow } from "~/components/agreements/AgreementRows";
import { m } from "~/paraglide/messages";

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
    return {
      templates: (tplBody.data ?? []) as Array<{ id: string; name?: string; updatedAt?: string; createdAt?: string }>,
    };
  } catch {
    return { templates: [] };
  }
}

export default function AgreementsPage() {
  const { templates } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: m.library_layout_title(), href: "/library" }, { label: m.library_agreements_heading() }]} />
      <PageHeader
        title={m.library_agreements_heading()}
        meta={m.library_agreements_meta_templates({ templates: templates.length })}
        actions={<Button variant="primary">{m.library_agreements_new()}</Button>}
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
                <TemplateRow key={t.id} t={t} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
