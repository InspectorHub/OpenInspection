import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/agreements";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { SignaturePad } from "~/components/SignaturePad";
import { SignerList, type SignerRow } from "~/components/agreements/SignerList";
import { SendAgreementModal, type SendAgreementPayload } from "~/components/agreements/SendAgreementModal";

export function meta() {
  return [{ title: "Agreements - OpenInspection" }];
}

interface RequestRow {
  id: string;
  agreementName?: string;
  clientName?: string;
  clientEmail?: string;
  status: string;
  signersTotal?: number;
  signersSigned?: number;
}

interface InspectionOption {
  id: string;
  propertyAddress: string | null;
  clientName: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const [tplRes, reqRes, inspRes] = await Promise.all([
      api.admin.agreements.$get(),
      api.admin.agreements.requests.$get(),
      api.inspections.index.$get({ query: { limit: "50" } }).catch(() => null),
    ]);
    const tplBody = tplRes.ok ? ((await tplRes.json()) as Record<string, unknown>) : { data: [] };
    const reqBody = reqRes.ok ? ((await reqRes.json()) as Record<string, unknown>) : { data: [] };
    const inspBody = inspRes?.ok ? ((await inspRes.json()) as { data?: unknown[] }) : { data: [] };
    const inspections = ((inspBody.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
      id: String(i.id ?? ""),
      propertyAddress: (i.propertyAddress as string | null) ?? null,
      clientName: (i.clientName as string | null) ?? null,
    }));
    return {
      templates: (tplBody.data ?? []) as Array<{ id: string; name?: string; updatedAt?: string; createdAt?: string }>,
      requests: (reqBody.data ?? []) as RequestRow[],
      inspections,
    };
  } catch {
    return { templates: [], requests: [], inspections: [] as InspectionOption[] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "inspector-sign");
  const api = createApi(context, { token });

  // Track I-a Task 9 — per-signer detail / actions for the Signing tab.
  if (intent === "load-signers") {
    const requestId = String(formData.get("requestId") ?? "");
    if (!requestId) return { ok: false, intent, error: "Missing requestId" };
    const res = await api.admin.agreements.requests[":requestId"].signers.$get({ param: { requestId } });
    if (!res.ok) return { ok: false, intent, requestId, error: `API ${res.status}` };
    const body = (await res.json()) as { data: SignerRow[] };
    return { ok: true, intent, requestId, signers: body.data };
  }

  if (intent === "remind") {
    const requestId = String(formData.get("requestId") ?? "");
    const signerId = String(formData.get("signerId") ?? "");
    const res = await api.admin.agreements.requests[":requestId"].signers[":signerId"].remind.$post({
      param: { requestId, signerId },
    });
    if (res.status === 429) return { ok: false, intent, signerId, error: "Reminded within the last hour. Try again later." };
    if (res.status === 409) return { ok: false, intent, signerId, error: "This signer is no longer awaiting signature." };
    if (!res.ok) return { ok: false, intent, signerId, error: `Could not send reminder (${res.status}).` };
    return { ok: true, intent, signerId };
  }

  // Track I-a Task 9 review remediation — multi-signer send from the Signing
  // tab. Posts the envelope payload to the admin send endpoint; the response
  // carries { requestId, signers[] } with NO token material. Revalidation
  // surfaces the new request row in the list.
  if (intent === "send") {
    const agreementId = String(formData.get("agreementId") ?? "");
    const inspectionId = String(formData.get("inspectionId") ?? "");
    const completionPolicy = String(formData.get("completionPolicy") ?? "all") as "all" | "one";
    let signers: Array<{ name: string; email: string; role?: string }> = [];
    try {
      signers = JSON.parse(String(formData.get("signers") ?? "[]"));
    } catch {
      return { ok: false, intent, error: "Malformed signers payload." };
    }
    if (!agreementId) return { ok: false, intent, error: "Pick an agreement template." };
    if (!inspectionId) return { ok: false, intent, error: "Pick an inspection." };
    if (signers.length === 0) return { ok: false, intent, error: "Add at least one signer." };
    const res = await api.admin.agreements.send.$post({
      json: {
        agreementId,
        inspectionId,
        completionPolicy,
        signers: signers.map((s) => ({
          name: s.name,
          email: s.email,
          ...(s.role ? { role: s.role as "client" | "co_client" | "agent" | "other" } : {}),
        })),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, intent, error: `Could not send (${res.status}): ${text.slice(0, 200)}` };
    }
    const body = (await res.json()) as { data?: { requestId?: string } };
    return { ok: true, intent, requestId: body.data?.requestId };
  }

  if (intent === "copy-link") {
    const requestId = String(formData.get("requestId") ?? "");
    const signerId = String(formData.get("signerId") ?? "");
    const res = await api.admin.agreements.requests[":requestId"].signers[":signerId"].link.$get({
      param: { requestId, signerId },
    });
    if (!res.ok) return { ok: false, intent, signerId, error: `Could not get link (${res.status}).` };
    const body = (await res.json()) as { data: { url: string } };
    return { ok: true, intent, signerId, url: body.data.url };
  }

  // Default: inspector pre-sign (legacy behavior).
  const envelopeId = String(formData.get("envelopeId") ?? "");
  const signatureBase64 = String(formData.get("signatureBase64") ?? "");
  if (!envelopeId || !signatureBase64) {
    return { ok: false, intent: "inspector-sign", error: "Missing envelopeId or signatureBase64" };
  }
  const res = await api.admin["agreement-requests"][":id"]["inspector-sign"].$post({
    param: { id: envelopeId },
    json: { signatureBase64 },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, intent: "inspector-sign", error: `API returned ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true, intent: "inspector-sign" };
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

/** Per-envelope progress chip, e.g. "1/2 signed". Hidden for 0-signer rows. */
function ProgressBadge({ row }: { row: RequestRow }) {
  const total = row.signersTotal ?? 0;
  if (total <= 0) return null;
  const signed = row.signersSigned ?? 0;
  return (
    <Pill tone={signed >= total ? "sat" : "gen"}>
      {signed}/{total} signed
    </Pill>
  );
}

/** Expandable per-request signer detail — mounts the shared SignerList. */
function RequestDetail({ requestId }: { requestId: string }) {
  const loadFetcher = useFetcher<typeof action>();
  // Separate fetchers per competing mutation (RR rule: shared fetcher aborts in-flight).
  const remindFetcher = useFetcher<typeof action>();
  const copyFetcher = useFetcher<typeof action>();

  useEffect(() => {
    loadFetcher.submit({ intent: "load-signers", requestId }, { method: "post" });
    // Intentional: loadFetcher is omitted from deps — its identity is unstable
    // (a new ref every render from useFetcher); submit is keyed on requestId only.
    // react-hooks/exhaustive-deps is not wired in this project's ESLint config.
  }, [requestId]);

  // Reload signers after a successful reminder (lastRemindedAt changed).
  useEffect(() => {
    if (remindFetcher.data?.ok && remindFetcher.data.intent === "remind") {
      loadFetcher.submit({ intent: "load-signers", requestId }, { method: "post" });
    }
    // Intentional: loadFetcher is omitted from deps — its identity is unstable
    // (a new ref every render); re-fetch is keyed on remindFetcher.data + requestId.
    // react-hooks/exhaustive-deps is not wired in this project's ESLint config.
  }, [remindFetcher.data, requestId]);

  const signers = (loadFetcher.data?.ok && loadFetcher.data.intent === "load-signers"
    ? loadFetcher.data.signers
    : []) as SignerRow[];

  if (loadFetcher.state !== "idle" && signers.length === 0) {
    return <div className="px-4 py-3 text-[13px] text-ih-fg-3">Loading signers…</div>;
  }

  // Remind is fire-and-forget through its own fetcher; the result (including a
  // 429/409 friendly message) renders as an inline banner, never an alert.
  const onRemind = (signerId: string) => {
    remindFetcher.submit({ intent: "remind", requestId, signerId }, { method: "post" });
  };

  // Copy-link resolves the persistent URL via its own fetcher, then SignerList
  // writes it to the clipboard. We await the fetcher settling for THIS signer.
  const onCopyLink = (signerId: string) =>
    new Promise<string>((resolve, reject) => {
      copyFetcher.submit({ intent: "copy-link", requestId, signerId }, { method: "post" });
      const started = Date.now();
      const poll = () => {
        const data = copyFetcher.data;
        if (data && data.intent === "copy-link" && data.signerId === signerId && copyFetcher.state === "idle") {
          if (data.ok && "url" in data && data.url) return resolve(data.url);
          return reject(new Error(!data.ok && "error" in data ? data.error : "Could not get link."));
        }
        if (Date.now() - started > 6000) return reject(new Error("Timed out fetching link."));
        setTimeout(poll, 120);
      };
      poll();
    });

  const remindError =
    remindFetcher.data && !remindFetcher.data.ok && remindFetcher.data.intent === "remind"
      ? remindFetcher.data.error
      : null;

  return (
    <div className="px-4 py-3 bg-ih-bg-muted/40">
      {remindError && <p className="text-[12px] text-ih-bad-fg mb-2">{remindError}</p>}
      <SignerList signers={signers} onRemind={onRemind} onCopyLink={onCopyLink} />
    </div>
  );
}

export default function AgreementsPage() {
  const { templates, requests, inspections } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("templates");
  const [signingId, setSigningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  // Track I-a Task 9 — multi-signer send modal. Its own fetcher (separate from
  // the inspector-sign / load-signers / remind / copy-link fetchers per RR's
  // shared-fetcher abort rule) plus the agreement+inspection selection it needs.
  const [sendOpen, setSendOpen] = useState(false);
  const [sendAgreementId, setSendAgreementId] = useState("");
  const [sendInspectionId, setSendInspectionId] = useState("");
  const [sendOk, setSendOk] = useState(false);
  const sendFetcher = useFetcher<typeof action>();
  const sendBusy = sendFetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === "inspector-sign") {
      setSigningId(null);
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  // On a successful send: close the modal, surface success, let revalidation
  // pull the new request into the Signing list.
  useEffect(() => {
    if (sendFetcher.data?.ok && sendFetcher.data.intent === "send") {
      setSendOpen(false);
      setSendOk(true);
      revalidator.revalidate();
    }
  }, [sendFetcher.data, revalidator]);

  const submitSend = (payload: SendAgreementPayload) => {
    setSendOk(false);
    sendFetcher.submit(
      {
        intent: "send",
        agreementId: sendAgreementId,
        inspectionId: sendInspectionId,
        completionPolicy: payload.completionPolicy,
        signers: JSON.stringify(payload.signers),
      },
      { method: "post" },
    );
  };

  const sendError =
    sendFetcher.data && !sendFetcher.data.ok && sendFetcher.data.intent === "send"
      ? sendFetcher.data.error
      : null;

  const submitSignature = async (dataUri: string) => {
    fetcher.submit(
      { intent: "inspector-sign", envelopeId: signingId ?? "", signatureBase64: dataUri },
      { method: "post" },
    );
  };

  const showingTemplates = activeTab === "templates";
  const rows = showingTemplates ? templates : requests;

  return (
    <div className="space-y-[18px]">
      <Breadcrumb items={[{ label: "Library", href: "/library" }, { label: "Agreements" }]} />
      <PageHeader
        title="Agreements"
        meta={`${templates.length} templates · ${requests.length} requests`}
        actions={<Button variant="primary">+ New agreement</Button>}
      />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {!showingTemplates && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-ih-border bg-ih-bg-card p-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Agreement</span>
            <select
              value={sendAgreementId}
              onChange={(e) => setSendAgreementId(e.target.value)}
              className="px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none min-w-[180px]"
            >
              <option value="">Select template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name || "Untitled"}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Inspection</span>
            <select
              value={sendInspectionId}
              onChange={(e) => setSendInspectionId(e.target.value)}
              className="px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none min-w-[220px]"
            >
              <option value="">Select inspection…</option>
              {inspections.map((i) => (
                <option key={i.id} value={i.id}>
                  {[i.propertyAddress, i.clientName].filter(Boolean).join(" · ") || i.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            disabled={!sendAgreementId || !sendInspectionId}
            onClick={() => { setSendOk(false); setSendOpen(true); }}
          >
            Send for signing
          </Button>
          {sendOk && <span className="text-[13px] text-ih-good-fg self-center">Sent — signers emailed their links.</span>}
          {sendError && <span className="text-[13px] text-ih-bad-fg self-center">{sendError}</span>}
        </div>
      )}

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
                ? templates.map((t) => (
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
                : requests.map((r) => (
                    <>
                      <tr
                        key={r.id}
                        className="hover:bg-ih-bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                      >
                        <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
                          {r.agreementName || "Untitled"}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-ih-fg-3">
                          {r.clientName || r.clientEmail || "--"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Pill tone={pillToneFor(r.status)}>{pillLabelFor(r.status)}</Pill>
                            <ProgressBadge row={r} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.status === "signed" ? (
                            <div className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
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
                              onClick={(e) => { e.stopPropagation(); setSigningId(r.id); }}
                            >
                              Sign now
                            </button>
                          ) : (
                            <span className="text-[13px] text-ih-fg-3">
                              {expandedId === r.id ? "Hide" : "View signers"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedId === r.id && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={4} className="p-0">
                            <RequestDetail requestId={r.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
            </tbody>
          </table>
        </Card>
      )}

      {sendOpen && (
        <SendAgreementModal
          onSend={submitSend}
          onClose={() => setSendOpen(false)}
          busy={sendBusy}
        />
      )}

      {signingId && (
        <div className="fixed inset-0 bg-[rgba(15,23,42,0.4)] flex items-center justify-center z-50">
          <div className="bg-ih-bg-card rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-3">Inspector signature</h3>
            <p className="text-sm text-ih-fg-3 mb-4">
              Draw your signature below. This will pre-sign the agreement; the client signs separately after you send it.
            </p>
            <SignaturePad onSubmit={submitSignature} onCancel={() => setSigningId(null)} label="Save signature" />
            {fetcher.data?.ok === false && fetcher.data.intent === "inspector-sign" && (
              <p className="text-sm text-ih-bad-fg mt-3">{fetcher.data.error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
