import { useState, useEffect } from "react";
import { useLoaderData, Link, isRouteErrorResponse, useRouteError, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/inspection-hub";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { deriveBlockStates, formatCents, isReportShipped, type HubPayload } from "~/lib/hub-blocks";
import { INSPECTION_STATUS, REPORT_STATUS, isReportPublished, humanizeStatus, statusTone } from "~/lib/status";
import { getEffectivePriceCents } from "~/lib/effective-price";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, Card, Pill, Button, EmptyState } from "@core/shared-ui";
import DocumentsSection, {
  type DocumentItem,
  type DocumentCategory,
  type DocumentVisibility,
} from "~/components/DocumentsSection";
import { SendAgreementModal } from "~/components/inspection-hub/SendAgreementModal";
import { RequestPaymentModal } from "~/components/inspection-hub/RequestPaymentModal";
import { PublishReportModal } from "~/components/inspection-hub/PublishReportModal";
import { CreateReinspectionModal } from "~/components/inspection-hub/CreateReinspectionModal";
import { toActionResult } from "~/lib/inspection-hub-actions";
import type { ReinspectCandidate } from "~/lib/inspection-hub-helpers";

export function meta() {
  return [{ title: "Inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * The full `/api/inspections/{id}/hub` payload (Issue #111). `HubPayload`
 * (from hub-blocks.ts) types the status-derivation slice; this interface
 * extends it with the descriptive fields the six cards render. Field names
 * mirror InspectionHubSchema in server/lib/validations/inspection.schema.ts.
 */
interface HubData extends HubPayload {
  inspection: HubPayload["inspection"] & {
    id: string;
    propertyAddress: string;
    clientName: string | null;
    clientEmail: string | null;
    clientPhone: string | null;
    clientContactId: string | null;
    date: string | null;
    inspectorId: string | null;
    templateId: string | null;
    price: number;
    paymentStatus: string;
    coverPhoto: string | null;
    referredByAgentId: string | null;
    sellingAgentId: string | null;
    createdAt: string | null;
    // reportStatus is inherited from HubPayload["inspection"] but listed here for clarity
  };
  tenantSlug: string;
  people: {
    inspector: { id: string; name: string | null; email: string; phone: string | null } | null;
    client: { name: string; email: string | null; phone: string | null } | null;
    buyerAgents: PeopleAgent[];
    listingAgents: PeopleAgent[];
  };
  services: Array<{ id: string; name: string; priceCents: number }>;
  agreements: Array<{ id: string; name: string }>;
}

interface PeopleAgent {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  agency: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const id = params.id;
  const api = createApi(context, { token });
  // One aggregate round trip drives the whole page (Task 1's hub endpoint).
  const res = await api.inspections[":id"].hub.$get({ param: { id } });
  // Mirror template-edit.tsx: a non-OK response goes to the ErrorBoundary with
  // an actionable status rather than rendering a blank page. res.status is typed
  // to the success code by the hono client; read the real value as a number.
  if (!res.ok) {
    throw new Response("Inspection not found", {
      status: (res.status as number) === 403 ? 403 : 404,
    });
  }
  const body = await res.json();
  const hub = ((body as Record<string, unknown>).data ?? {}) as unknown as HubData;

  // #119 Task 6 — re-inspection candidates for the "Create re-inspection" modal.
  // Only meaningful off a PUBLISHED baseline (reportStatus=published), so we
  // fetch them only then. Best-effort: a failure degrades to an empty list.
  let reinspectCandidates: ReinspectCandidate[] = [];
  if (isReportPublished(hub.inspection?.reportStatus)) {
    const candRes = await api.inspections[":id"]["reinspect-candidates"]
      .$get({ param: { id } })
      .catch(() => null);
    if (candRes && candRes.ok) {
      const candBody = (await candRes.json()) as { data?: { candidates?: ReinspectCandidate[] } };
      reinspectCandidates = candBody.data?.candidates ?? [];
    }
  }

  // Track L (E) — client SMS consent status for the People card. Best-effort:
  // a failure degrades to "none" (the attest affordance still renders).
  const consentRes = await api.smsAdmin.sms.consent.$get({ query: { inspectionId: id } }).catch(() => null);
  const smsConsent =
    consentRes && consentRes.ok
      ? (((await consentRes.json()) as { data?: { consent?: "granted" | "revoked" | "none" } }).data?.consent ?? "none")
      : "none";

  // Capability: whether the current user can publish reports (owner/manager/inspector).
  // Best-effort: falls back to false (inspector will see submit-only flow).
  // The cast mirrors dashboard.tsx — hono/client collapses the typed union.
  let canPublishCap = false;
  const meGet = api.auth?.me?.$get as unknown as ((args?: unknown) => Promise<Response>) | undefined;
  const meRes = meGet ? await meGet().catch(() => null) : null;
  if (meRes && meRes.ok) {
    const meBody = (await meRes.json().catch(() => ({}))) as { data?: { user?: { role?: string } } };
    const role = meBody.data?.user?.role ?? 'inspector';
    canPublishCap = new Set(['owner', 'manager', 'inspector']).has(role);
  }

  // Inspector documents (unified portal section ⑦). The inspector document
  // routes are not in the typed client, so fetch the list directly via the
  // in-process API binding, forwarding the request cookie for auth. Best-effort:
  // a non-OK response degrades to an empty list.
  let documents: DocumentItem[] = [];
  try {
    const apiWorker = (context.cloudflare.env as unknown as { API_WORKER?: { fetch: typeof fetch } })
      .API_WORKER;
    const docsRes = await (apiWorker?.fetch ?? fetch)(
      new Request(`https://internal/api/inspections/${id}/documents`, {
        headers: { cookie: request.headers.get("cookie") ?? "" },
      }),
    );
    if (docsRes.ok) {
      documents = (((await docsRes.json()) as { data?: DocumentItem[] }).data ?? []) as DocumentItem[];
    }
  } catch {
    // Best-effort: fail open to empty list
  }

  return { hub, smsConsent, reinspectCandidates, canPublishCap, documents };
}

/* ------------------------------------------------------------------ */
/*  Action — intent dispatch (mirrors dashboard.tsx)                   */
/* ------------------------------------------------------------------ */

export async function action({ request, params, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const id = params.id;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const api = createApi(context, { token });

  if (intent === "send-agreement") {
    // Empty strings → omit, so the endpoint falls back to its defaults
    // (tenant's first agreement template / inspection clientEmail).
    const agreementId = String(formData.get("agreementId") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const res = await api.inspections[":id"]["agreement-requests"].$post({
      param: { id },
      json: {
        ...(agreementId ? { agreementId } : {}),
        ...(email ? { email } : {}),
      },
    });
    // Surface the API rejection (B-4: never unconditional ok:true).
    return toActionResult(res, "send-agreement", "Could not send the agreement. Please try again.");
  }

  if (intent === "request-payment") {
    const res = await api.invoices["request-payment"].$post({
      json: { inspectionId: id },
    });
    return toActionResult(res, "request-payment", "Could not request payment. Please try again.");
  }

  if (intent === "attest-sms") {
    // Track L (E) — inspector attestation that the client agreed to receive texts.
    const res = await api.smsAdmin.sms.attest.$post({ json: { inspectionId: id } });
    return toActionResult(res, "attest-sms", "Could not record consent. Please try again.");
  }

  if (intent === "publish") {
    // theme: the editor's PublishModal posts no `theme`, so it rides the
    // schema default ('modern'). We send the same value explicitly here —
    // the hub deliberately renders NO theme picker (YAGNI), matching the
    // editor's effective tenant default.
    const res = await api.inspections[":id"].publish.$post({
      param: { id },
      json: {
        theme: "modern",
        notifyClient: formData.get("notifyClient") === "on",
        notifyAgent: formData.get("notifyAgent") === "on",
        requireSignature: formData.get("requireSignature") === "on",
        requirePayment: formData.get("requirePayment") === "on",
      },
    });
    return toActionResult(res, "publish", "Could not publish the report. Please try again.");
  }

  if (intent === "submit") {
    const submitApi = api.inspections[":id"] as unknown as {
      submit: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await submitApi.submit.$post({ param: { id } });
    return toActionResult(res, "submit", "Could not submit the report. Please try again.");
  }

  if (intent === "return") {
    const returnApi = api.inspections[":id"] as unknown as {
      return: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await returnApi.return.$post({ param: { id } });
    return toActionResult(res, "return", "Could not return the report. Please try again.");
  }

  if (intent === "unpublish") {
    const unpublishApi = api.inspections[":id"] as unknown as {
      unpublish: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await unpublishApi.unpublish.$post({ param: { id } });
    return toActionResult(res, "unpublish", "Could not unpublish the report. Please try again.");
  }

  if (intent === "create-reinspection") {
    // #119 Task 6 — carry the checked baseline items forward into a new
    // re-inspection. The form submits one `selectedItemIds` value per checked
    // box; the endpoint 400s if the baseline isn't published.
    const selectedItemIds = formData
      .getAll("selectedItemIds")
      .map((v) => String(v))
      .filter((v) => v.length > 0);
    if (selectedItemIds.length === 0) {
      return {
        ok: false,
        intent: "create-reinspection" as const,
        error: "Select at least one item to carry forward.",
        newId: undefined,
      };
    }
    const res = await api.inspections[":id"].reinspect.$post({
      param: { id },
      json: { selectedItemIds },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        intent: "create-reinspection" as const,
        error: err?.error?.message ?? "Could not create the re-inspection. Please try again.",
        newId: undefined,
      };
    }
    const created = (await res.json()) as { data?: { id?: string } };
    return {
      ok: true,
      intent: "create-reinspection" as const,
      error: undefined,
      newId: created.data?.id,
    };
  }

  return { ok: false, intent: undefined, error: "Unknown action." };
}

/* ------------------------------------------------------------------ */
/*  Report action matrix (pure — testable)                            */
/* ------------------------------------------------------------------ */

/**
 * Derive which report action buttons to render given the current user's
 * capabilities, the report status, and the inspection lifecycle status.
 * Returns an ordered array of action identifiers for the Report card.
 */
export function reportActions(
  caps: { publish: boolean },
  reportStatus: string,
  inspectionStatus: string,
): Array<'submit' | 'publish' | 'return' | 'unpublish'> {
  if (inspectionStatus !== INSPECTION_STATUS.COMPLETED) return [];
  if (reportStatus === REPORT_STATUS.PUBLISHED) return caps.publish ? ['unpublish'] : [];
  if (reportStatus === REPORT_STATUS.SUBMITTED) return caps.publish ? ['publish', 'return'] : [];
  // in_progress (or unknown)
  return caps.publish ? ['publish'] : ['submit'];
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function InspectionHubPage() {
  const { hub, smsConsent, reinspectCandidates, canPublishCap, documents } = useLoaderData<typeof loader>();
  const { inspection, people, services, tenantSlug } = hub;
  const blocks = deriveBlockStates(hub);
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Documents (unified portal section ⑦) — client-side upload/delete against the
  // authed inspector document routes (same-origin → the JWT cookie auto-sends),
  // then revalidate the loader to refresh the list.
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const onDocUpload = async (
    file: File,
    opts: { category: DocumentCategory; visibility: DocumentVisibility; label?: string },
  ) => {
    setDocError(null);
    setDocUploading(true);
    try {
      const qs = new URLSearchParams({
        filename: file.name,
        category: opts.category,
        visibility: opts.visibility,
        ...(opts.label ? { label: opts.label } : {}),
      });
      const res = await fetch(`/api/inspections/${inspection.id}/documents?${qs}`, {
        method: "PUT",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "content-length": String(file.size),
        },
        body: file,
      });
      if (!res.ok) {
        setDocError("Upload failed. Please try again.");
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError("Upload failed. Please try again.");
    } finally {
      setDocUploading(false);
    }
  };

  const onDocDelete = async (docId: string) => {
    setDocError(null);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setDocError("Could not delete the document. Please try again.");
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError("Could not delete the document. Please try again.");
    }
  };

  // Track L (E) — SMS consent attestation. Dedicated fetcher (never share).
  const attestSms = useFetcher<typeof action>();
  const attesting = attestSms.state !== "idle";

  // Each mutation gets its own dedicated fetcher (B-17: never share fetchers
  // between mutations) and a modal that auto-closes on success — the loader
  // revalidation then refreshes the affected block. `useModalFetcher` collapses
  // that shared open-state + fetcher + error + close-on-success pattern.
  //  - send-agreement → refreshes agreementRequests
  //  - request-payment → refreshes the invoice block
  //  - publish → flips the Report card to Published + reveals the header link
  const agreementModal = useModalFetcher("send-agreement");
  const paymentModal = useModalFetcher("request-payment");
  const publishModal = useModalFetcher("publish");

  // Submit / return / unpublish — dedicated fetchers (B-17: never share).
  const submitReport = useFetcher<typeof action>();
  const returnReport = useFetcher<typeof action>();
  const unpublishReport = useFetcher<typeof action>();
  const submittingReport = submitReport.state !== "idle";
  const returningReport = returnReport.state !== "idle";
  const unpublishingReport = unpublishReport.state !== "idle";

  // Create-re-inspection modal — its own dedicated fetcher (B-17). Only
  // published baselines can re-inspect. Unlike the other modals it does NOT
  // auto-close on success: the effect below navigates to the new inspection's
  // editor instead (mirrors the app's create-then-navigate flow).
  const reinspectModal = useModalFetcher("create-reinspection", { closeOnSuccess: false });
  const createReinspection = reinspectModal.fetcher;
  useEffect(() => {
    if (
      createReinspection.state === "idle" &&
      createReinspection.data?.intent === "create-reinspection" &&
      createReinspection.data.ok &&
      createReinspection.data.newId
    ) {
      const newId = createReinspection.data.newId;
      reinspectModal.setOpen(false);
      // Mirror the new-inspection wizard: a freshly created draft lands in the
      // editor so the inspector can start filling out the carried-forward items.
      navigate(`/inspections/${newId}/edit`);
    }
  }, [createReinspection.state, createReinspection.data, navigate]);

  // "View report" only makes sense once the report is shipped to the client.
  const reportShipped = isReportPublished(inspection.reportStatus);

  // Report card affordance: active publish CTA vs read-only-shipped.
  const reportPublished = isReportShipped(hub);

  // Report action matrix — what buttons to show in the Report card.
  const reportActionList = reportActions(
    { publish: canPublishCap },
    inspection.reportStatus,
    inspection.status,
  );

  const servicesTotalCents = services.reduce((sum, s) => sum + s.priceCents, 0);
  const allAgents = [...people.buyerAgents, ...people.listingAgents];

  // Invoice amount the SERVER will request — same money authority chain as the
  // endpoint (invoice > Σ services > inspections.price). Drives the modal amount
  // and the card's headline figure.
  const invoiceAmountCents = getEffectivePriceCents({
    invoiceAmountCents: hub.invoice?.amountCents ?? null,
    serviceLines: services.map((s) => ({ priceSnapshot: s.priceCents })),
    inspectionPriceCents: inspection.price,
  });
  const invoicePaid = hub.invoice?.status === "paid";
  // "sent" and "partial" both mean the request has gone out — show resend + link.
  const invoiceSent = hub.invoice?.status === "sent" || hub.invoice?.status === "partial";

  return (
    <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9 space-y-[18px]">
      {/* Breadcrumb — Inspections > this inspection */}
      <Breadcrumb
        items={[
          { label: "Inspections", href: "/inspections" },
          { label: inspection.propertyAddress || "Untitled inspection" },
        ]}
      />

      {/* PageHeader — status pill in meta, address title, date + inspector meta */}
      <PageHeader
        title={inspection.propertyAddress || "Untitled inspection"}
        meta={
          <span className="flex items-center gap-2 flex-wrap">
            <Pill tone={statusTone(inspection.status)}>
              {humanizeStatus(inspection.status)}
            </Pill>
            <span className="text-ih-fg-3">
              {formatInspectionDateTime(inspection.date)}
            </span>
            {people.inspector?.name && (
              <span className="text-ih-fg-3">&middot; {people.inspector.name}</span>
            )}
          </span>
        }
        actions={
          <>
            <Link
              to={`/inspections/${inspection.id}/edit`}
              className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600"
            >
              Open editor
            </Link>
            {reportShipped && (
              <Link
                to={`/report-view/${tenantSlug}/${inspection.id}`}
                className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted"
              >
                View report
              </Link>
            )}
          </>
        }
      />

      {/* Six blocks — responsive 2-col grid (1-col on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. People ------------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="People" />
          <div className="space-y-3">
            {/* Client */}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                Client
              </p>
              {people.client ? (
                <div className="text-[13px] text-ih-fg-1">
                  <p className="font-medium">
                    {/* Link to the contact record only when the inspection
                        carries a clientContactId — the inline client name
                        (denormalized columns) has no contact row to open. */}
                    {inspection.clientContactId ? (
                      <Link
                        to={`/contacts/${inspection.clientContactId}`}
                        className="hover:text-ih-primary hover:underline"
                      >
                        {people.client.name}
                      </Link>
                    ) : (
                      people.client.name
                    )}
                  </p>
                  {people.client.email && (
                    <a href={`mailto:${people.client.email}`} className="text-ih-primary hover:underline block">
                      {people.client.email}
                    </a>
                  )}
                  {people.client.phone && (
                    <a href={`tel:${people.client.phone}`} className="text-ih-primary hover:underline block">
                      {people.client.phone}
                    </a>
                  )}
                  {/* Track L (E) — SMS consent status + inspector attestation */}
                  <ClientSmsConsent
                    consent={smsConsent}
                    fetcher={attestSms}
                    attesting={attesting}
                  />
                </div>
              ) : inspection.clientName ? (
                // Bare-text fallback when only the denormalized name is present.
                <p className="text-[13px] text-ih-fg-1">{inspection.clientName}</p>
              ) : (
                <p className="text-[13px] text-ih-fg-4">No client</p>
              )}
            </div>

            {/* Agents (buyer + listing) */}
            {allAgents.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                  Agents
                </p>
                <div className="space-y-2">
                  {allAgents.map((agent) => (
                    <div key={agent.id} className="text-[13px] text-ih-fg-1">
                      <p className="font-medium">
                        {/* agent.id is the contacts row id (getPeopleCard reads
                            referredByAgentId/sellingAgentId from contacts), so the
                            name always links to the contact detail page. */}
                        <Link
                          to={`/contacts/${agent.id}`}
                          className="hover:text-ih-primary hover:underline"
                        >
                          {agent.name}
                        </Link>
                        {agent.agency && (
                          <span className="text-ih-fg-3 font-normal"> &middot; {agent.agency}</span>
                        )}
                      </p>
                      {agent.email && (
                        <a href={`mailto:${agent.email}`} className="text-ih-primary hover:underline block">
                          {agent.email}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inspector */}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1">
                Inspector
              </p>
              {people.inspector ? (
                <p className="text-[13px] text-ih-fg-1 font-medium">
                  {people.inspector.name || people.inspector.email}
                </p>
              ) : (
                <p className="text-[13px] text-ih-fg-4">Unassigned</p>
              )}
            </div>
          </div>
        </Card>

        {/* 2. Schedule ---------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Schedule" />
          <p className="text-[15px] font-medium text-ih-fg-1">
            {formatInspectionDateTime(inspection.date)}
          </p>
          <Link
            to={`/inspections/${inspection.id}/edit`}
            className="text-[12px] font-bold text-ih-primary hover:underline mt-3 inline-block"
          >
            Reschedule in editor
          </Link>
        </Card>

        {/* 3. Services ---------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Services" />
          {services.length === 0 ? (
            <EmptyState title="No services" description="No services have been added to this inspection." />
          ) : (
            <div className="divide-y divide-ih-border">
              {services.map((svc) => (
                <div key={svc.id} className="flex items-center justify-between py-2 text-[13px]">
                  <span className="text-ih-fg-1">{svc.name}</span>
                  <span className="text-ih-fg-2 font-medium tabular-nums">
                    {formatCents(svc.priceCents)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2 text-[13px] font-bold">
                <span className="text-ih-fg-1">Total</span>
                <span className="text-ih-fg-1 tabular-nums">{formatCents(servicesTotalCents)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* 4. Agreement --------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Agreement" pill={blocks.agreement} />
          {hub.agreementRequests.length > 0 ? (
            <div className="divide-y divide-ih-border mb-3">
              {hub.agreementRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between py-2 text-[12px]">
                  <span className="text-ih-fg-2 truncate mr-2">{req.clientEmail}</span>
                  <span className="text-ih-fg-4 shrink-0">
                    {humanizeStatus(req.status)}
                    {(req.signedAt || req.createdAt) && (
                      <> &middot; {formatInspectionDateTime(req.signedAt || req.createdAt)}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-ih-fg-3 mb-3">No agreement requests yet.</p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => agreementModal.setOpen(true)}
          >
            Send agreement
          </Button>
        </Card>

        {/* 5. Invoice ----------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title="Invoice" pill={blocks.invoice} />
          <p className="text-[15px] font-medium text-ih-fg-1 mb-3">
            {formatCents(invoiceAmountCents)}
          </p>
          {invoicePaid ? (
            // Paid is terminal — read-only (the pill already shows "Paid").
            <p className="text-[12px] text-ih-fg-3">Payment received.</p>
          ) : invoiceSent ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => paymentModal.setOpen(true)}
              >
                Resend request
              </Button>
              <CopyLinkButton url={`/invoice/${inspection.id}`} />
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => paymentModal.setOpen(true)}
            >
              Request payment
            </Button>
          )}
        </Card>

        {/* 6. Report ------------------------------------------------ */}
        <Card className="p-5">
          <BlockHeading title="Report" pill={blocks.report} />
          {reportPublished ? (
            // Already shipped — read-only for publishing. The header "View report"
            // link covers viewing. #119: a published baseline can spawn a
            // re-inspection that carries forward its still-open flagged items.
            <>
              <p className="text-[12px] text-ih-fg-3 mb-3">
                Report delivered to the client.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => reinspectModal.setOpen(true)}
                >
                  Create re-inspection
                </Button>
                {reportActionList.includes('unpublish') && (
                  <unpublishReport.Form method="post">
                    <input type="hidden" name="intent" value="unpublish" />
                    <button
                      type="submit"
                      disabled={unpublishingReport}
                      className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-60"
                    >
                      {unpublishingReport ? "Unpublishing…" : "Unpublish"}
                    </button>
                  </unpublishReport.Form>
                )}
              </div>
            </>
          ) : reportActionList.length > 0 ? (
            <>
              {inspection.reportStatus === 'submitted' && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  Report submitted for review.
                </p>
              )}
              {inspection.reportStatus === 'in_progress' && hub.publishReadiness.ready && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  All required fields are complete.
                </p>
              )}
              {inspection.reportStatus === 'in_progress' && !hub.publishReadiness.ready && hub.publishReadiness.blockingCount > 0 && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  {hub.publishReadiness.blockingCount} blocker(s) to resolve before publishing.
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {reportActionList.includes('publish') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => publishModal.setOpen(true)}
                  >
                    Publish report
                  </Button>
                )}
                {reportActionList.includes('submit') && (
                  <submitReport.Form method="post">
                    <input type="hidden" name="intent" value="submit" />
                    <button
                      type="submit"
                      disabled={submittingReport}
                      className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
                    >
                      {submittingReport ? "Submitting…" : "Submit for review"}
                    </button>
                  </submitReport.Form>
                )}
                {reportActionList.includes('return') && (
                  <returnReport.Form method="post">
                    <input type="hidden" name="intent" value="return" />
                    <button
                      type="submit"
                      disabled={returningReport}
                      className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-60"
                    >
                      {returningReport ? "Returning…" : "Return to inspector"}
                    </button>
                  </returnReport.Form>
                )}
                {inspection.reportStatus === 'in_progress' && !hub.publishReadiness.ready && hub.publishReadiness.blockingCount > 0 && (
                  <Link
                    to={`/inspections/${inspection.id}/edit`}
                    className="text-[12px] font-bold text-ih-primary hover:underline"
                  >
                    Resolve in editor
                  </Link>
                )}
              </div>
            </>
          ) : (
            // Pre-completion (in progress) — nothing to publish yet.
            <p className="text-[12px] text-ih-fg-3">Report is still in progress.</p>
          )}
        </Card>
      </div>

      {/* Documents — shared section (unified portal ⑦). Renders regardless of
          report status (uploads are pre/intra-inspection). Inspector can upload
          with a visibility toggle and delete any document. */}
      <DocumentsSection
        items={documents}
        canUpload
        showVisibilityToggle
        allowDeleteAny
        downloadHref={(docId) => `/api/inspections/${inspection.id}/documents/${docId}`}
        onUpload={onDocUpload}
        onDelete={onDocDelete}
        uploading={docUploading}
        error={docError}
      />

      {/* Send-agreement modal — custom (no window.confirm) */}
      {agreementModal.open && (
        <SendAgreementModal
          agreements={hub.agreements}
          defaultEmail={inspection.clientEmail ?? ""}
          fetcher={agreementModal.fetcher}
          submitting={agreementModal.busy}
          error={agreementModal.error}
          onClose={() => agreementModal.setOpen(false)}
        />
      )}

      {/* Request-payment modal — custom (no window.confirm) */}
      {paymentModal.open && (
        <RequestPaymentModal
          recipientEmail={inspection.clientEmail ?? ""}
          amountLabel={formatCents(invoiceAmountCents)}
          resend={invoiceSent}
          fetcher={paymentModal.fetcher}
          submitting={paymentModal.busy}
          error={paymentModal.error}
          onClose={() => paymentModal.setOpen(false)}
        />
      )}

      {/* Publish modal — custom (no window.confirm) */}
      {publishModal.open && (
        <PublishReportModal
          agreementRequired={inspection.agreementRequired}
          paymentRequired={inspection.paymentRequired}
          fetcher={publishModal.fetcher}
          submitting={publishModal.busy}
          error={publishModal.error}
          onClose={() => publishModal.setOpen(false)}
        />
      )}

      {/* Create-re-inspection modal — custom (no window.confirm) */}
      {reinspectModal.open && (
        <CreateReinspectionModal
          candidates={reinspectCandidates}
          fetcher={reinspectModal.fetcher}
          submitting={reinspectModal.busy}
          error={reinspectModal.error}
          onClose={() => reinspectModal.setOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal + fetcher pairing hook                                       */
/* ------------------------------------------------------------------ */

/**
 * Pairs a modal's open-state with its own dedicated action fetcher (B-17: never
 * share fetchers between mutations). Derives the busy flag, the intent-matched
 * error, and (by default) closes the modal once the action succeeds. Pass
 * `closeOnSuccess: false` when the caller drives its own post-success effect
 * (e.g. the re-inspection flow navigates instead of closing).
 */
function useModalFetcher<I extends string>(
  intent: I,
  opts?: { closeOnSuccess?: boolean },
) {
  const closeOnSuccess = opts?.closeOnSuccess ?? true;
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const succeeded =
    fetcher.state === "idle" && fetcher.data?.intent === intent && fetcher.data.ok;
  const error =
    fetcher.data?.intent === intent && !fetcher.data.ok ? fetcher.data.error : undefined;

  useEffect(() => {
    if (closeOnSuccess && open && succeeded) setOpen(false);
  }, [closeOnSuccess, open, succeeded]);

  return { open, setOpen, fetcher, busy, error, succeeded };
}

/* ------------------------------------------------------------------ */
/*  Client SMS consent status + attestation (Track L)                 */
/* ------------------------------------------------------------------ */

function ClientSmsConsent({
  consent,
  fetcher,
  attesting,
}: {
  consent: "granted" | "revoked" | "none";
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  attesting: boolean;
}) {
  const error =
    fetcher.data?.intent === "attest-sms" && !fetcher.data.ok
      ? fetcher.data.error
      : undefined;

  const label =
    consent === "granted" ? "granted" : consent === "revoked" ? "revoked" : "not recorded";
  const tone =
    consent === "granted" ? "text-ih-ok-fg" : consent === "revoked" ? "text-ih-bad-fg" : "text-ih-fg-4";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span className="text-ih-fg-3">
        Client SMS: <span className={`font-bold ${tone}`}>{label}</span>
      </span>
      {/* Offer the attestation only when not already granted. Framed as an
          inspector confirmation that the client agreed (not a consent-less
          override) — the deliberate basis for phone/in-person bookings. */}
      {consent !== "granted" && (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="attest-sms" />
          <button
            type="submit"
            disabled={attesting}
            className="text-[11px] font-bold text-ih-primary hover:underline disabled:opacity-60"
          >
            {attesting ? "Recording…" : "Client agreed to receive texts — I confirm"}
          </button>
        </fetcher.Form>
      )}
      {error && <span className="text-ih-bad-fg">{error}</span>}
    </div>
  );
}

/** Copies a public link to the clipboard with a transient "Copied" state. */
function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    const absolute =
      typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
    void navigator.clipboard?.writeText(absolute).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

/** Shared block heading: a label plus an optional derived status pill. */
function BlockHeading({ title, pill }: { title: string; pill?: { tone: import("~/lib/hub-blocks").PillTone; label: string } }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
        {title}
      </h2>
      {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error boundary                                                     */
/* ------------------------------------------------------------------ */

/**
 * Surfaces a missing/forbidden inspection (404/403) or an unexpected render
 * error as an actionable message with a route back, instead of a blank page.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message =
    status === 404
      ? "This inspection could not be found. It may have been deleted."
      : status === 403
        ? "You do not have permission to view this inspection."
        : "Something went wrong while opening the inspection.";

  return (
    <div className="max-w-[1080px] mx-auto pt-16 px-9 flex flex-col items-center gap-3 text-center">
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      <Link
        to="/dashboard"
        className="h-9 px-4 inline-flex items-center rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
