import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/agreements";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";
import { SignaturePad } from "~/components/SignaturePad";

export function meta() {
  return [{ title: "Agreements - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const [tplRes, reqRes] = await Promise.all([
      api.admin.agreements.$get(),
      api.admin.agreements.requests.$get(),
    ]);
    const tplBody = tplRes.ok ? ((await tplRes.json()) as Record<string, unknown>) : { data: [] };
    const reqBody = reqRes.ok ? ((await reqRes.json()) as Record<string, unknown>) : { data: [] };
    return {
      templates: (tplBody.data ?? []) as unknown[],
      requests: (reqBody.data ?? []) as unknown[],
    };
  } catch {
    return { templates: [], requests: [] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const envelopeId = String(formData.get("envelopeId") ?? "");
  const signatureBase64 = String(formData.get("signatureBase64") ?? "");
  if (!envelopeId || !signatureBase64) {
    return { ok: false, error: "Missing envelopeId or signatureBase64" };
  }
  const api = createApi(context, { token });
  const res = await api.admin["agreement-requests"][":id"]["inspector-sign"].$post({
    param: { id: envelopeId },
    json: { signatureBase64 },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `API returned ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

const TABS = [
  { id: "templates", label: "Templates" },
  { id: "signing", label: "Signing" },
];

type StatusTone = "sat" | "gen" | "neutral";
function pillToneFor(status: string): StatusTone {
  if (status === "signed") return "sat";
  if (status === "declined" || status === "expired") return "neutral";
  return "gen";
}
function pillLabelFor(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function AgreementsPage() {
  const { templates, requests } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("templates");
  const [signingId, setSigningId] = useState<string | null>(null);
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (fetcher.data?.ok) {
      setSigningId(null);
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  const submitSignature = async (dataUri: string) => {
    await new Promise<void>((resolve) => {
      fetcher.submit(
        { envelopeId: signingId ?? "", signatureBase64: dataUri },
        { method: "post" },
      );
      resolve();
    });
  };

  const showingTemplates = activeTab === "templates";
  const rows = showingTemplates ? templates : requests;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="Library · Agreements"
        title="Agreements"
        meta={`${templates.length} templates · ${requests.length} requests`}
        actions={<Button variant="primary">+ New agreement</Button>}
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={showingTemplates ? "No agreement templates yet" : "No signed agreements yet"}
            description={
              showingTemplates
                ? 'Click "+ New agreement" above to create your first agreement template.'
                : "Signed agreements will appear here after clients complete the signing process."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Title</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">
                  {showingTemplates ? "Last updated" : "Client"}
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">Status</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ih-border">
              {showingTemplates
                ? templates.map((t: any) => (
                    <tr key={t.id} className="hover:bg-ih-bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
                        {t.name || "Untitled"}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ih-fg-3">
                        {t.updatedAt || t.createdAt || "--"}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone="sat">Active</Pill>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">Edit</button>
                      </td>
                    </tr>
                  ))
                : requests.map((r: any) => (
                    <tr key={r.id} className="hover:bg-ih-bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
                        {r.agreementName || "Untitled"}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ih-fg-3">
                        {r.clientName || r.clientEmail || "--"}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={pillToneFor(r.status)}>{pillLabelFor(r.status)}</Pill>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "signed" ? (
                          <div className="flex justify-end gap-3">
                            <a
                              className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                              href={`/api/admin/agreement-requests/${r.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Signed PDF
                            </a>
                            <a
                              className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                              href={`/api/admin/agreement-requests/${r.id}/certificate.pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Certificate
                            </a>
                            <a
                              className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                              href={`/api/admin/agreement-requests/${r.id}/evidence.zip`}
                              download={`evidence-${r.id.slice(0, 8)}.zip`}
                              rel="noopener noreferrer"
                            >
                              Evidence pack
                            </a>
                          </div>
                        ) : r.status === "pending" ? (
                          <button
                            className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                            onClick={() => setSigningId(r.id)}
                          >
                            Sign now
                          </button>
                        ) : (
                          <button className="text-[13px] text-ih-fg-3 hover:opacity-80">View</button>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </Card>
      )}

      {signingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-3">Inspector signature</h3>
            <p className="text-sm text-ih-fg-3 mb-4">
              Draw your signature below. This will pre-sign the agreement; the client signs separately after you send it.
            </p>
            <SignaturePad onSubmit={submitSignature} onCancel={() => setSigningId(null)} label="Save signature" />
            {fetcher.data?.ok === false && (
              <p className="text-sm text-red-600 mt-3">{fetcher.data.error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
