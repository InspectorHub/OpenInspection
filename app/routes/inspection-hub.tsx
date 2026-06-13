import { useState, useEffect } from "react";
import { useLoaderData, Link, isRouteErrorResponse, useRouteError, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/inspection-hub";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { deriveBlockStates, formatCents, canPublish, isReportShipped, type HubPayload } from "~/lib/hub-blocks";
import { getEffectivePriceCents } from "~/lib/effective-price";
import { PageHeader, Card, Pill, Button, EmptyState } from "@core/shared-ui";

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

/**
 * #119 Task 6 — a baseline report item the inspector can carry forward into a
 * re-inspection. `open` pre-checks the still-open flagged set in the modal.
 */
interface ReinspectCandidate {
  itemId: string;
  label: string;
  originalNotes: string | null;
  open: boolean;
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
  // Only meaningful off a PUBLISHED baseline, so we fetch them only then (the
  // endpoint returns [] for unpublished anyway). Best-effort: a failure degrades
  // to an empty list and the action gates publication server-side.
  let reinspectCandidates: ReinspectCandidate[] = [];
  if (hub.inspection?.status === "published" || hub.inspection?.status === "delivered") {
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

  return { hub, smsConsent, reinspectCandidates };
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
    if (!res.ok) {
      // Surface the API rejection (B-4: never unconditional ok:true).
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        intent: "send-agreement" as const,
        error: err?.error?.message ?? "Could not send the agreement. Please try again.",
      };
    }
    return { ok: true, intent: "send-agreement" as const, error: undefined };
  }

  if (intent === "request-payment") {
    const res = await api.invoices["request-payment"].$post({
      json: { inspectionId: id },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        intent: "request-payment" as const,
        error: err?.error?.message ?? "Could not request payment. Please try again.",
      };
    }
    return { ok: true, intent: "request-payment" as const, error: undefined };
  }

  if (intent === "attest-sms") {
    // Track L (E) — inspector attestation that the client agreed to receive texts.
    const res = await api.smsAdmin.sms.attest.$post({ json: { inspectionId: id } });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        intent: "attest-sms" as const,
        error: err?.error?.message ?? "Could not record consent. Please try again.",
      };
    }
    return { ok: true, intent: "attest-sms" as const, error: undefined };
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
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        intent: "publish" as const,
        error: err?.error?.message ?? "Could not publish the report. Please try again.",
      };
    }
    return { ok: true, intent: "publish" as const, error: undefined };
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
/*  Status humanization                                               */
/* ------------------------------------------------------------------ */

/** snake_case status → Title Case for the eyebrow (e.g. "in_progress" → "In Progress"). */
function humanizeStatus(status: string): string {
  return status
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function InspectionHubPage() {
  const { hub, smsConsent, reinspectCandidates } = useLoaderData<typeof loader>();
  const { inspection, people, services, tenantSlug } = hub;
  const blocks = deriveBlockStates(hub);
  const navigate = useNavigate();

  // Track L (E) — SMS consent attestation. Dedicated fetcher (never share).
  const attestSms = useFetcher<typeof action>();
  const attesting = attestSms.state !== "idle";

  // Send-agreement modal — its own dedicated fetcher (B-17: never share
  // fetchers between mutations). Close on success; the loader revalidation
  // refreshes agreementRequests automatically.
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const sendAgreement = useFetcher<typeof action>();
  const sendingAgreement = sendAgreement.state !== "idle";
  const agreementError =
    sendAgreement.data?.intent === "send-agreement" && !sendAgreement.data.ok
      ? sendAgreement.data.error
      : undefined;
  useEffect(() => {
    if (
      agreementModalOpen &&
      sendAgreement.state === "idle" &&
      sendAgreement.data?.intent === "send-agreement" &&
      sendAgreement.data.ok
    ) {
      setAgreementModalOpen(false);
    }
  }, [agreementModalOpen, sendAgreement.state, sendAgreement.data]);

  // Request-payment modal — its own dedicated fetcher (B-17). Close on success;
  // the loader revalidation refreshes the invoice block automatically.
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const requestPayment = useFetcher<typeof action>();
  const requestingPayment = requestPayment.state !== "idle";
  const paymentError =
    requestPayment.data?.intent === "request-payment" && !requestPayment.data.ok
      ? requestPayment.data.error
      : undefined;
  useEffect(() => {
    if (
      paymentModalOpen &&
      requestPayment.state === "idle" &&
      requestPayment.data?.intent === "request-payment" &&
      requestPayment.data.ok
    ) {
      setPaymentModalOpen(false);
    }
  }, [paymentModalOpen, requestPayment.state, requestPayment.data]);

  // Publish modal — its own dedicated fetcher (B-17). Close on success; the
  // loader revalidation flips the Report card to Published + reveals the
  // header View report link automatically.
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const publish = useFetcher<typeof action>();
  const publishing = publish.state !== "idle";
  const publishError =
    publish.data?.intent === "publish" && !publish.data.ok
      ? publish.data.error
      : undefined;
  useEffect(() => {
    if (
      publishModalOpen &&
      publish.state === "idle" &&
      publish.data?.intent === "publish" &&
      publish.data.ok
    ) {
      setPublishModalOpen(false);
    }
  }, [publishModalOpen, publish.state, publish.data]);

  // Create-re-inspection modal — its own dedicated fetcher (B-17). On success
  // the action returns the new inspection id; navigate to its hub (mirrors the
  // app's create-then-navigate flow). Only published baselines can re-inspect.
  const [reinspectModalOpen, setReinspectModalOpen] = useState(false);
  const createReinspection = useFetcher<typeof action>();
  const creatingReinspection = createReinspection.state !== "idle";
  const reinspectError =
    createReinspection.data?.intent === "create-reinspection" && !createReinspection.data.ok
      ? createReinspection.data.error
      : undefined;
  useEffect(() => {
    if (
      createReinspection.state === "idle" &&
      createReinspection.data?.intent === "create-reinspection" &&
      createReinspection.data.ok &&
      createReinspection.data.newId
    ) {
      const newId = createReinspection.data.newId;
      setReinspectModalOpen(false);
      // Mirror the new-inspection wizard: a freshly created draft lands in the
      // editor so the inspector can start filling out the carried-forward items.
      navigate(`/inspections/${newId}/edit`);
    }
  }, [createReinspection.state, createReinspection.data, navigate]);

  // "View report" only makes sense once the report is shipped to the client.
  const reportShipped =
    inspection.status === "delivered" || inspection.status === "published";

  // Report card affordance (Task 9): active publish CTA vs disabled-with-blockers
  // vs read-only-shipped.
  const reportPublished = isReportShipped(hub);
  const publishReady = canPublish(hub);

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
      {/* PageHeader — status eyebrow, address title, date + inspector meta */}
      <PageHeader
        eyebrow={humanizeStatus(inspection.status)}
        eyebrowColor="indigo"
        title={inspection.propertyAddress || "Untitled inspection"}
        meta={
          <>
            {formatInspectionDateTime(inspection.date)}
            {people.inspector?.name && (
              <span> &middot; {people.inspector.name}</span>
            )}
          </>
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
            onClick={() => setAgreementModalOpen(true)}
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
                onClick={() => setPaymentModalOpen(true)}
              >
                Resend request
              </Button>
              <CopyLinkButton url={`/r/${inspection.id}/invoice`} />
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPaymentModalOpen(true)}
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
              {reportPublished && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setReinspectModalOpen(true)}
                >
                  Create re-inspection
                </Button>
              )}
            </>
          ) : publishReady ? (
            <>
              <p className="text-[12px] text-ih-fg-3 mb-3">
                All required fields are complete.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPublishModalOpen(true)}
              >
                Publish report
              </Button>
            </>
          ) : !hub.publishReadiness.ready ? (
            <>
              <p className="text-[12px] text-ih-fg-3 mb-3">
                {hub.publishReadiness.blockingCount} blocker(s) to resolve before publishing
              </p>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled
                  title="Resolve blockers first"
                >
                  Publish report
                </Button>
                <Link
                  to={`/inspections/${inspection.id}/edit`}
                  className="text-[12px] font-bold text-ih-primary hover:underline"
                >
                  Resolve in editor
                </Link>
              </div>
            </>
          ) : (
            // Pre-completion (in progress) — nothing to publish yet.
            <p className="text-[12px] text-ih-fg-3">Report is still in progress.</p>
          )}
        </Card>
      </div>

      {/* Send-agreement modal — custom (no window.confirm) */}
      {agreementModalOpen && (
        <SendAgreementModal
          agreements={hub.agreements}
          defaultEmail={inspection.clientEmail ?? ""}
          fetcher={sendAgreement}
          submitting={sendingAgreement}
          error={agreementError}
          onClose={() => setAgreementModalOpen(false)}
        />
      )}

      {/* Request-payment modal — custom (no window.confirm) */}
      {paymentModalOpen && (
        <RequestPaymentModal
          recipientEmail={inspection.clientEmail ?? ""}
          amountLabel={formatCents(invoiceAmountCents)}
          resend={invoiceSent}
          fetcher={requestPayment}
          submitting={requestingPayment}
          error={paymentError}
          onClose={() => setPaymentModalOpen(false)}
        />
      )}

      {/* Publish modal — custom (no window.confirm) */}
      {publishModalOpen && (
        <PublishReportModal
          agreementRequired={inspection.agreementRequired}
          paymentRequired={inspection.paymentRequired}
          fetcher={publish}
          submitting={publishing}
          error={publishError}
          onClose={() => setPublishModalOpen(false)}
        />
      )}

      {/* Create-re-inspection modal — custom (no window.confirm) */}
      {reinspectModalOpen && (
        <CreateReinspectionModal
          candidates={reinspectCandidates}
          fetcher={createReinspection}
          submitting={creatingReinspection}
          error={reinspectError}
          onClose={() => setReinspectModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Send-agreement modal                                              */
/* ------------------------------------------------------------------ */

function SendAgreementModal({
  agreements,
  defaultEmail,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  agreements: Array<{ id: string; name: string }>;
  defaultEmail: string;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Send agreement</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col">
          <input type="hidden" name="intent" value="send-agreement" />
          <div className="px-5 py-4 space-y-4">
            <div>
              <label htmlFor="agreement-email" className="block text-[12px] font-bold text-ih-fg-2 mb-1">
                Client email
              </label>
              <input
                id="agreement-email"
                name="email"
                type="email"
                required
                defaultValue={defaultEmail}
                placeholder="client@example.com"
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
              />
            </div>

            <div>
              <label htmlFor="agreement-template" className="block text-[12px] font-bold text-ih-fg-2 mb-1">
                Agreement
              </label>
              <select
                id="agreement-template"
                name="agreementId"
                defaultValue={agreements[0]?.id ?? ""}
                disabled={agreements.length === 0}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary disabled:opacity-60"
              >
                {agreements.length === 0 ? (
                  <option value="">No agreement template available</option>
                ) : (
                  agreements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {error && (
              <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || agreements.length === 0}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send agreement"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Request-payment modal                                             */
/* ------------------------------------------------------------------ */

function RequestPaymentModal({
  recipientEmail,
  amountLabel,
  resend,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  recipientEmail: string;
  amountLabel: string;
  resend: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  const title = resend ? "Resend payment request" : "Request payment";
  const submitLabel = resend ? "Resend request" : "Send request";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col">
          <input type="hidden" name="intent" value="request-payment" />
          <div className="px-5 py-4 space-y-4">
            <div>
              <p className="text-[12px] font-bold text-ih-fg-2 mb-1">Recipient</p>
              <p className="text-[13px] text-ih-fg-1">
                {recipientEmail || (
                  <span className="text-ih-fg-4">No client email on this inspection</span>
                )}
              </p>
            </div>

            <div>
              <p className="text-[12px] font-bold text-ih-fg-2 mb-1">Amount</p>
              <p className="text-[18px] font-bold text-ih-fg-1 tabular-nums">{amountLabel}</p>
            </div>

            {error && (
              <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !recipientEmail}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Sending…" : submitLabel}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
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

/* ------------------------------------------------------------------ */
/*  Publish-report modal                                              */
/* ------------------------------------------------------------------ */

function PublishReportModal({
  agreementRequired,
  paymentRequired,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  agreementRequired: boolean;
  paymentRequired: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Publish report</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col">
          <input type="hidden" name="intent" value="publish" />
          {/* No theme picker — rides the editor's effective default (server
              'modern'); the action sends theme:"modern" explicitly. */}
          <div className="px-5 py-4 space-y-3">
            <ToggleRow
              name="notifyClient"
              label="Notify client by email"
              defaultChecked
            />
            <ToggleRow name="notifyAgent" label="Notify agent" defaultChecked={false} />
            <ToggleRow
              name="requireSignature"
              label="Require signature before viewing"
              defaultChecked={agreementRequired}
            />
            <ToggleRow
              name="requirePayment"
              label="Require payment before viewing"
              defaultChecked={paymentRequired}
            />

            {error && (
              <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Publishing…" : "Publish report"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

/** A labeled checkbox row for the publish modal toggles (DS tokens). */
function ToggleRow({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] text-ih-fg-1 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="rounded border-ih-border text-ih-primary focus:ring-ih-primary"
      />
      <span>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  Create-re-inspection modal (#119)                                 */
/* ------------------------------------------------------------------ */

function CreateReinspectionModal({
  candidates,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  candidates: ReinspectCandidate[];
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  const hasCandidates = candidates.length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Create re-inspection</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col min-h-0">
          <input type="hidden" name="intent" value="create-reinspection" />
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {hasCandidates ? (
              <>
                <p className="text-[12px] text-ih-fg-3">
                  Choose which items to carry forward. Still-open flagged items are
                  pre-selected.
                </p>
                <div className="divide-y divide-ih-border">
                  {candidates.map((c) => (
                    <label
                      key={c.itemId}
                      className="flex items-start gap-2.5 py-2 text-[13px] text-ih-fg-1 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="selectedItemIds"
                        value={c.itemId}
                        defaultChecked={c.open}
                        className="mt-0.5 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
                      />
                      <span className="min-w-0">
                        <span className="font-medium block">{c.label}</span>
                        {c.originalNotes && (
                          <span className="text-[12px] text-ih-fg-3 block truncate">
                            {c.originalNotes}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-ih-fg-4">
                This report has no items available to carry forward.
              </p>
            )}

            {error && (
              <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !hasCandidates}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create re-inspection"}
            </button>
          </div>
        </fetcher.Form>
      </div>
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
