import { useState, useEffect } from "react";
import { useLoaderData, Link, isRouteErrorResponse, useRouteError, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/inspection-hub";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useDisplayTimeZone } from "~/hooks/useSessionContext";
import {
  deriveBlockStates,
  formatCents,
  isReportShipped,
  latestPublishedAt,
  publishNotified,
  type HubPayload,
} from "~/lib/hub-blocks";
import { REPORT_STATUS, isReportPublished, humanizeStatus, statusTone } from "~/lib/status";
import { getEffectivePriceCents } from "~/lib/effective-price";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, Card, Pill, Button, EmptyState } from "@core/shared-ui";
import type { PillTone } from "~/lib/hub-blocks";
import DocumentsSection, {
  type DocumentItem,
  type DocumentCategory,
  type DocumentVisibility,
} from "~/components/DocumentsSection";
import { BlockHeading } from "~/components/inspection-hub/BlockHeading";
import { LifecycleCard } from "~/components/inspection-hub/LifecycleCard";
import { SendAgreementModal } from "~/components/inspection-hub/SendAgreementModal";
import { RequestPaymentModal } from "~/components/inspection-hub/RequestPaymentModal";
import { PublishReportModal } from "~/components/inspection-hub/PublishReportModal";
import { CreateReinspectionModal } from "~/components/inspection-hub/CreateReinspectionModal";
import { PublishNotice } from "~/components/inspection-hub/PublishNotice";
import { PeopleEditor, type PersonRow } from "~/components/inspection/PeopleEditor";
import { SendReportModal } from "~/components/inspection/SendReportModal";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import {
  toActionResult,
  handlePersonAdd,
  handlePersonRemove,
  handlePersonResetAccess,
  handlePersonMakePrimary,
  handleReportLinkExpiry,
  handleSearchContacts,
} from "~/lib/inspection-hub-actions";
import { versionDiffHref, type ReinspectCandidate, type ReportVersionRow } from "~/lib/inspection-hub-helpers";
import { isAdminRole } from "~/lib/access";
import { m } from "~/paraglide/messages";
import { getCloudflareEnv } from "~/lib/load-context";

export function meta() {
  return [{ title: m.inspections_hub_meta_title() }];
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
    date: string | null;
    inspectorId: string | null;
    templateId: string | null;
    price: number;
    paymentStatus: string;
    coverPhoto: string | null;
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
  // Plan 1B Task 5 — same role read also drives the People editor's admin-only
  // messaging (role-profile management lives behind requireRole('owner','manager')).
  let isAdmin = false;
  const meGet = api.auth?.me?.$get as unknown as ((args?: unknown) => Promise<Response>) | undefined;
  const meRes = meGet ? await meGet().catch(() => null) : null;
  if (meRes && meRes.ok) {
    const meBody = (await meRes.json().catch(() => ({}))) as { data?: { user?: { role?: string } } };
    const role = meBody.data?.user?.role ?? 'inspector';
    canPublishCap = new Set(['owner', 'manager', 'inspector']).has(role);
    isAdmin = isAdminRole(role);
  }

  // Plan 1B Task 5 — editable People section: every contact/role pairing on
  // the inspection via inspection_people (Task 3), plus the tenant's role
  // profiles for the "add person" role picker (Task 2). Both best-effort:
  // `people` degrades to [] on failure (the card still renders, just empty);
  // `roleProfiles` is admin-gated server-side (owner/manager) — a non-admin
  // viewer (inspector) degrades to an empty list, same graceful pattern as
  // contacts.tsx's Roles tab. Optional-chained (mirrors the `meGet` lookup
  // above) so a narrower mocked api-client in unit tests degrades cleanly
  // instead of throwing on a missing property.
  const peopleGet = api.inspections?.[":id"]?.people?.$get as unknown as
    | ((args: { param: { id: string } }) => Promise<Response>)
    | undefined;
  const peopleRes = peopleGet ? await peopleGet({ param: { id } }).catch(() => null) : null;
  const people: PersonRow[] =
    peopleRes && peopleRes.ok ? (((await peopleRes.json()) as { data?: PersonRow[] }).data ?? []) : [];

  const roleProfilesGet = api.roleProfiles?.index?.$get as unknown as (() => Promise<Response>) | undefined;
  const roleProfilesRes = roleProfilesGet ? await roleProfilesGet().catch(() => null) : null;
  const roleProfiles: RoleProfile[] =
    roleProfilesRes && roleProfilesRes.ok
      ? (((await roleProfilesRes.json()) as { data?: RoleProfile[] }).data ?? [])
      : [];

  // Inspector documents (unified portal section ⑦). The inspector document
  // routes are not in the typed client, so fetch the list directly via the
  // in-process API binding, forwarding the request cookie for auth. Best-effort:
  // a non-OK response degrades to an empty list.
  let documents: DocumentItem[] = [];
  try {
    const apiWorker = getCloudflareEnv(context).API_WORKER;
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

  // IA-40 — published report versions for the Report card's Versions list.
  // Best-effort and unconditional (mirrors the people/consent fetches above): an
  // inspection that was published then unpublished still carries its version
  // history, and that history drives both the diff links and whether the next
  // publish is an amendment. Degrades to an empty list on any failure.
  const versionsGet = api.inspections?.[":id"]?.versions?.$get as unknown as
    | ((args: { param: { id: string } }) => Promise<Response>)
    | undefined;
  const versionsRes = versionsGet ? await versionsGet({ param: { id } }).catch(() => null) : null;
  const versions: ReportVersionRow[] =
    versionsRes && versionsRes.ok
      ? (((await versionsRes.json()) as { data?: { versions?: ReportVersionRow[] } }).data?.versions ?? [])
      : [];

  return { hub, smsConsent, reinspectCandidates, canPublishCap, documents, people, roleProfiles, isAdmin, versions };
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
    // (tenant's first agreement template / the inspection's primary client
    // email, resolved via inspection_people — see PeopleService.getPrimaryClient).
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
    return toActionResult(res, "send-agreement", m.inspections_hub_error_send_agreement());
  }

  if (intent === "request-payment") {
    const res = await api.invoices["request-payment"].$post({
      json: { inspectionId: id },
    });
    return toActionResult(res, "request-payment", m.inspections_hub_error_request_payment());
  }

  if (intent === "attest-sms") {
    // Track L (E) — inspector attestation that the client agreed to receive texts.
    const res = await api.smsAdmin.sms.attest.$post({ json: { inspectionId: id } });
    return toActionResult(res, "attest-sms", m.inspections_hub_error_attest_sms());
  }

  if (intent === "publish") {
    // theme: the editor's PublishModal posts no `theme`, so it rides the
    // schema default ('modern'). We send the same value explicitly here —
    // the hub deliberately renders NO theme picker (YAGNI), matching the
    // editor's effective tenant default.
    // summary: IA-40 — for an amendment (a re-publish, versionNumber > 1) the
    // inspector describes what changed; the server records it on the frozen
    // report_versions row (snapshotOnPublish already accepts it). Empty → omit
    // so a first publish rides the server default.
    const summary = String(formData.get("summary") ?? "").trim();
    const notifyClient = formData.get("notifyClient") === "on";
    const notifyAgent = formData.get("notifyAgent") === "on";
    const res = await api.inspections[":id"].publish.$post({
      param: { id },
      json: {
        theme: "modern",
        notifyClient,
        notifyAgent,
        requireSignature: formData.get("requireSignature") === "on",
        requirePayment: formData.get("requirePayment") === "on",
        ...(summary ? { summary } : {}),
      },
    });
    // Publishing succeeded silently: the modal closed and the card flipped to a
    // sentence claiming the client had the report, whether or not anyone was
    // emailed. The answer only exists in this form, so it travels back with the
    // result rather than being guessed at on the client.
    const published = await toActionResult(res, "publish", m.inspections_hub_error_publish());
    return { ...published, notified: publishNotified({ notifyClient, notifyAgent }) };
  }

  if (intent === "submit") {
    const submitApi = api.inspections[":id"] as unknown as {
      submit: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await submitApi.submit.$post({ param: { id } });
    return toActionResult(res, "submit", m.inspections_hub_error_submit());
  }

  if (intent === "return") {
    const returnApi = api.inspections[":id"] as unknown as {
      return: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await returnApi.return.$post({ param: { id } });
    return toActionResult(res, "return", m.inspections_hub_error_return());
  }

  if (intent === "unpublish") {
    const unpublishApi = api.inspections[":id"] as unknown as {
      unpublish: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await unpublishApi.unpublish.$post({ param: { id } });
    return toActionResult(res, "unpublish", m.inspections_hub_error_unpublish());
  }

  if (intent === "complete") {
    const completeApi = api.inspections[":id"] as unknown as {
      complete: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
    const res = await completeApi.complete.$post({ param: { id } });
    return toActionResult(res, "complete", m.inspections_hub_lifecycle_error());
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
        error: m.inspections_hub_error_reinspect_no_items(),
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
        error: err?.error?.message ?? m.inspections_hub_error_reinspect(),
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

  // Plan 1B Task 5 — People editor intents. Handlers live in
  // inspection-hub-actions.ts (same extraction convention as toActionResult
  // above) — person-add's inline-create-then-link path and search-contacts'
  // response mapping are long enough to keep this dispatcher scannable.
  if (intent === "person-add") return handlePersonAdd(api, id, formData);
  if (intent === "person-remove") return handlePersonRemove(api, id, formData);
  // IA-36 — the report-link verbs that live on the People card.
  if (intent === "person-reset-access") return handlePersonResetAccess(api, id, formData);
  if (intent === "person-make-primary") return handlePersonMakePrimary(api, id, formData);
  if (intent === "report-link-expiry") return handleReportLinkExpiry(api, id, formData);
  if (intent === "search-contacts") return handleSearchContacts(api, formData);

  // Spec 2 Task 7 — "Send report" modal. Recipients/channels arrive as JSON
  // strings (SendReportModal's hidden fields) mirroring the endpoint's own
  // body shape (server/lib/validations/send-report.schema.ts).
  if (intent === "send-report") {
    const recipients = JSON.parse(String(formData.get("recipients") ?? "[]"));
    const channels = JSON.parse(String(formData.get("channels") ?? '["email"]'));
    const res = await api.inspections[":id"]["send-report-pdf"].$post({
      param: { id },
      json: { recipients, channels },
    });
    return toActionResult(res, "send-report", m.inspections_hub_error_send_report());
  }

  return { ok: false, intent: undefined, error: m.inspections_hub_error_unknown_action() };
}

/* ------------------------------------------------------------------ */
/*  Report action matrix (pure — testable)                            */
/* ------------------------------------------------------------------ */

/**
 * Report action buttons for the current user's capabilities and report status.
 * The order lifecycle is deliberately not an input: it tracks the job, not the
 * report, and gating on it here left the card empty for every inspection that
 * was never marked completed. Returns an ordered array of action identifiers.
 */
export function reportActions(
  caps: { publish: boolean },
  reportStatus: string,
): Array<'submit' | 'publish' | 'return' | 'unpublish'> {
  if (reportStatus === REPORT_STATUS.PUBLISHED) return caps.publish ? ['unpublish'] : [];
  if (reportStatus === REPORT_STATUS.SUBMITTED) return caps.publish ? ['publish', 'return'] : [];
  return caps.publish ? ['publish'] : ['submit']; // in_progress (or unknown)
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function InspectionHubPage() {
  const { hub, smsConsent, reinspectCandidates, canPublishCap, documents, people, roleProfiles, isAdmin, versions } =
    useLoaderData<typeof loader>();
  // `peopleCard` is the read-only getPeopleCard() projection (client/agents/
  // inspector — still used for the header meta line + modal default emails);
  // `people` (destructured above) is the Task 3 editable inspection_people
  // list PeopleEditor renders. Two different shapes, hence the rename here.
  const { inspection, people: peopleCard, services, tenantSlug } = hub;
  const displayTz = useDisplayTimeZone();
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
        setDocError(m.inspections_hub_doc_upload_failed());
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError(m.inspections_hub_doc_upload_failed());
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
        setDocError(m.inspections_hub_doc_delete_failed());
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError(m.inspections_hub_doc_delete_failed());
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
  const completeInspection = useFetcher<typeof action>();
  const submittingReport = submitReport.state !== "idle";
  const returningReport = returnReport.state !== "idle";
  const unpublishingReport = unpublishReport.state !== "idle";

  // Create-re-inspection modal — its own dedicated fetcher (B-17). Only
  // published baselines can re-inspect. Unlike the other modals it does NOT
  // auto-close on success: the effect below navigates to the new inspection's
  // editor instead (mirrors the app's create-then-navigate flow).
  // "Send report" modal (Spec 2 Task 7) — its own dedicated fetcher (B-17:
  // never share fetchers between mutations) and a local open flag; the modal
  // component itself derives submitting/error/auto-close from the fetcher.
  const [sendReportOpen, setSendReportOpen] = useState(false);
  const sendReportFetcher = useFetcher<typeof action>();

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

  // Shipped-to-client: gates the header "View report" link and the card body.
  const reportShipped = isReportShipped(hub);

  // When the report was last published. The Report card states this instead of
  // claiming a delivery nothing here records.
  const publishedAt = latestPublishedAt(versions);

  // Post-publish confirmation: the action reports who it emailed, PublishNotice
  // owns the dismissal.
  const publishData = publishModal.fetcher.data;
  const publishNotice =
    publishModal.succeeded && publishData && "notified" in publishData ? publishData.notified : null;

  // `publish` is the user's permission; the report's own eligibility lives in
  // canPublish, which reportShipped above reads.
  const reportActionList = reportActions({ publish: canPublishCap }, inspection.reportStatus);

  // IA-40 — when a version already exists, the next publish increments to
  // versionNumber > 1 (an amendment), so the publish modal asks what changed.
  const nextPublishIsAmendment = versions.length > 0;

  // Incomplete content: drives the count line, the "resolve" link, and whether
  // the action row has anything to hold.
  const reportBlockersPending =
    inspection.reportStatus === REPORT_STATUS.IN_PROGRESS &&
    !hub.publishReadiness.ready &&
    hub.publishReadiness.blockingCount > 0;

  const servicesTotalCents = services.reduce((sum, s) => sum + s.priceCents, 0);

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
    // The page shell (width, gutters) belongs to the auth layout this route now
    // renders inside — it was duplicated here, verbatim, from the days when the
    // hub stood outside it without the workspace nav.
    <div className="space-y-ih-list">
      {/* Breadcrumb — Inspections > this inspection */}
      <Breadcrumb
        items={[
          { label: m.inspections_hub_breadcrumb_inspections(), href: "/inspections" },
          { label: inspection.propertyAddress || m.inspections_hub_untitled() },
        ]}
      />

      {/* PageHeader — status pill in meta, address title, date + inspector meta */}
      <PageHeader
        title={inspection.propertyAddress || m.inspections_hub_untitled()}
        meta={
          <span className="flex items-center gap-2 flex-wrap">
            <Pill tone={statusTone(inspection.status)}>
              {humanizeStatus(inspection.status)}
            </Pill>
            <span className="text-ih-fg-3">
              {formatInspectionDateTime(inspection.date, undefined, displayTz)}
            </span>
            {peopleCard.inspector?.name && (
              <span className="text-ih-fg-3">&middot; {peopleCard.inspector.name}</span>
            )}
          </span>
        }
        actions={
          <>
            {/* The theme control that used to sit here was standing in for the
                sidebar's user menu, which this page did not have. It does now. */}
            <Link
              to={`/inspections/${inspection.id}/edit`}
              className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600"
            >
              {m.inspections_hub_action_open_editor()}
            </Link>
            {reportShipped && (
              <Link
                to={`/report-view/${tenantSlug}/${inspection.id}`}
                className="inline-flex items-center justify-center font-bold rounded-md transition-all h-9 px-4 text-[13px] gap-2 bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted"
              >
                {m.inspections_hub_action_view_report()}
              </Link>
            )}
          </>
        }
      />

      <PublishNotice notified={publishNotice} />

      {/* Six blocks — responsive 2-col grid (1-col on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. People — editable (Plan 1B Task 5): PeopleEditor sources rows
            from inspection_people (the `people` loader array) grouped by role
            kind, replacing the old read-only client/agents/inspector text
            block. Client SMS consent (Track L (E)) stays a small addendum
            underneath, keyed off the same primary-client projection
            (getPeopleCard) the rest of the page already uses. */}
        <div className="space-y-4">
          <PeopleEditor
            inspectionId={inspection.id}
            people={people}
            roleProfiles={roleProfiles}
            isAdmin={isAdmin}
          />
          {peopleCard.client && (
            <Card className="p-4">
              <ClientSmsConsent
                consent={smsConsent}
                fetcher={attestSms}
                attesting={attesting}
              />
            </Card>
          )}
        </div>

        {/* 2. Schedule ---------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title={m.inspections_hub_block_schedule()} />
          <p className="text-[15px] font-medium text-ih-fg-1">
            {formatInspectionDateTime(inspection.date, undefined, displayTz)}
          </p>
          <Link
            to={`/inspections/${inspection.id}/edit`}
            className="text-[12px] font-bold text-ih-primary hover:underline mt-3 inline-block"
          >
            {m.inspections_hub_schedule_reschedule()}
          </Link>
        </Card>

        {/* 2b. Order lifecycle — independent of report publishing. */}
        <LifecycleCard status={inspection.status} fetcher={completeInspection} />

        {/* 3. Services ---------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title={m.inspections_hub_block_services()} />
          {services.length === 0 ? (
            <EmptyState title={m.inspections_hub_services_empty_title()} description={m.inspections_hub_services_empty_desc()} />
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
                <span className="text-ih-fg-1">{m.inspections_hub_services_total()}</span>
                <span className="text-ih-fg-1 tabular-nums">{formatCents(servicesTotalCents)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* 4. Agreement --------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title={m.inspections_hub_block_agreement()} pill={blocks.agreement} />
          {hub.agreementRequests.length > 0 ? (
            <div className="divide-y divide-ih-border mb-3">
              {hub.agreementRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between py-2 text-[12px]">
                  <span className="text-ih-fg-2 truncate mr-2">{req.clientEmail}</span>
                  <span className="text-ih-fg-4 shrink-0">
                    {humanizeStatus(req.status)}
                    {(req.signedAt || req.createdAt) && (
                      <> &middot; {formatInspectionDateTime(req.signedAt || req.createdAt, undefined, displayTz)}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-ih-fg-3 mb-3">{m.inspections_hub_agreement_empty()}</p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => agreementModal.setOpen(true)}
          >
            {m.inspections_hub_agreement_send()}
          </Button>
        </Card>

        {/* 5. Invoice ----------------------------------------------- */}
        <Card className="p-5">
          <BlockHeading title={m.inspections_hub_block_invoice()} pill={blocks.invoice} />
          <p className="text-[15px] font-medium text-ih-fg-1 mb-3">
            {formatCents(invoiceAmountCents)}
          </p>
          {invoicePaid ? (
            // Paid is terminal — read-only (the pill already shows "Paid").
            <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_invoice_paid()}</p>
          ) : invoiceSent ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => paymentModal.setOpen(true)}
              >
                {m.inspections_hub_invoice_resend()}
              </Button>
              {/* IA-34 — the pay page is token-gated; copy the tokenized link the
                  server built, never a bare `/invoice/:id` (which now 401s). No
                  link when no primary client email exists to bind a token to. */}
              {hub.invoice?.payUrl && <CopyLinkButton url={hub.invoice.payUrl} />}
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => paymentModal.setOpen(true)}
            >
              {m.inspections_hub_invoice_request()}
            </Button>
          )}
        </Card>

        {/* 6. Report ------------------------------------------------ */}
        <Card className="p-5">
          <BlockHeading title={m.inspections_hub_block_report()} pill={blocks.report} />
          {reportShipped ? (
            // Already shipped — read-only for publishing. The header "View report"
            // link covers viewing. #119: a published baseline can spawn a
            // re-inspection that carries forward its still-open flagged items.
            <>
              {/* Publication, which report_versions records — not delivery, which
                  nothing here does. "Delivered to the client" was false for any
                  inspector who left the notify boxes unticked, and the Send
                  report button below is the tell. */}
              <p className="text-[12px] text-ih-fg-3 mb-3">
                {publishedAt
                  ? m.inspections_hub_report_published_on({
                      date: formatInspectionDateTime(new Date(publishedAt * 1000).toISOString(), undefined, displayTz),
                    })
                  : m.inspections_hub_report_published()}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => reinspectModal.setOpen(true)}
                >
                  {m.inspections_hub_report_create_reinspection()}
                </Button>
                {canPublishCap && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSendReportOpen(true)}
                  >
                    {m.inspections_hub_report_send()}
                  </Button>
                )}
                {reportActionList.includes('unpublish') && (
                  <unpublishReport.Form method="post">
                    <input type="hidden" name="intent" value="unpublish" />
                    <button
                      type="submit"
                      disabled={unpublishingReport}
                      className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-60"
                    >
                      {unpublishingReport ? m.inspections_hub_report_unpublishing() : m.inspections_hub_report_unpublish()}
                    </button>
                  </unpublishReport.Form>
                )}
              </div>
            </>
          ) : (
            // Not shipped yet: the status line always applies, the action row
            // only for roles that have an action to take.
            <>
              {inspection.reportStatus === 'submitted' && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  {m.inspections_hub_report_submitted()}
                </p>
              )}
              {inspection.reportStatus === 'in_progress' && hub.publishReadiness.ready && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  {m.inspections_hub_report_ready()}
                </p>
              )}
              {reportBlockersPending && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  {m.inspections_hub_report_blockers({ count: hub.publishReadiness.blockingCount })}
                </p>
              )}
              {(reportActionList.length > 0 || reportBlockersPending) && (
              <div className="flex items-center gap-2 flex-wrap">
                {reportActionList.includes('publish') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => publishModal.setOpen(true)}
                  >
                    {m.inspections_hub_report_publish()}
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
                      {submittingReport ? m.inspections_hub_report_submitting() : m.inspections_hub_report_submit()}
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
                      {returningReport ? m.inspections_hub_report_returning() : m.inspections_hub_report_return()}
                    </button>
                  </returnReport.Form>
                )}
                {reportBlockersPending && (
                  <Link
                    to={`/inspections/${inspection.id}/edit`}
                    className="text-[12px] font-bold text-ih-primary hover:underline"
                  >
                    {m.inspections_hub_report_resolve()}
                  </Link>
                )}
              </div>
              )}
            </>
          )}

          {/* IA-40 — Report versions. The signed, immutable version history had
              no entry point anywhere in the app; this is it. Each amendment
              links to a field-level diff against its immediate predecessor. */}
          {versions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-ih-border">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ih-fg-4 mb-2">
                {m.inspections_hub_versions_title()}
              </p>
              <ul className="space-y-2">
                {versions.map((v) => {
                  const href = versionDiffHref(inspection.id, v.versionNumber);
                  return (
                    <li key={v.versionNumber} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-ih-fg-1">
                            {m.inspections_hub_versions_version({ n: v.versionNumber })}
                          </span>
                          {v.versionNumber > 1 && (
                            <Pill tone="gen">{m.inspections_hub_versions_amendment()}</Pill>
                          )}
                          {v.publishedAt && (
                            <span className="text-[11px] text-ih-fg-4">
                              {formatInspectionDateTime(new Date(v.publishedAt * 1000).toISOString(), undefined, displayTz)}
                            </span>
                          )}
                        </div>
                        {v.summary && (
                          <p className="text-[12px] text-ih-fg-3 mt-0.5 line-clamp-2">{v.summary}</p>
                        )}
                      </div>
                      {href && (
                        <Link
                          to={href}
                          className="shrink-0 text-[12px] font-bold text-ih-primary hover:underline"
                        >
                          {m.inspections_hub_versions_view_changes()}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
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

      {/* Send-agreement modal — shared Modal primitive (no window.confirm) */}
      <SendAgreementModal
        open={agreementModal.open}
        agreements={hub.agreements}
        defaultEmail={peopleCard.client?.email ?? ""}
        fetcher={agreementModal.fetcher}
        submitting={agreementModal.busy}
        error={agreementModal.error}
        onClose={() => agreementModal.setOpen(false)}
      />

      {/* Request-payment modal — shared Modal primitive (no window.confirm) */}
      <RequestPaymentModal
        open={paymentModal.open}
        recipientEmail={peopleCard.client?.email ?? ""}
        amountLabel={formatCents(invoiceAmountCents)}
        resend={invoiceSent}
        fetcher={paymentModal.fetcher}
        submitting={paymentModal.busy}
        error={paymentModal.error}
        onClose={() => paymentModal.setOpen(false)}
      />

      {/* Publish modal — shared Modal primitive (no window.confirm) */}
      <PublishReportModal
        open={publishModal.open}
        agreementRequired={inspection.agreementRequired}
        paymentRequired={inspection.paymentRequired}
        isAmendment={nextPublishIsAmendment}
        fetcher={publishModal.fetcher}
        submitting={publishModal.busy}
        error={publishModal.error}
        onClose={() => publishModal.setOpen(false)}
      />

      {/* Send-report modal — shared Modal primitive (no window.confirm). Only
          mounted while open (SendReportModal always renders its Modal as
          open — see its own doc comment). */}
      {sendReportOpen && (
        <SendReportModal
          people={people}
          roleProfiles={roleProfiles}
          fetcher={sendReportFetcher}
          onClose={() => setSendReportOpen(false)}
        />
      )}

      {/* Create-re-inspection modal — shared Modal primitive (no window.confirm) */}
      <CreateReinspectionModal
        open={reinspectModal.open}
        candidates={reinspectCandidates}
        fetcher={reinspectModal.fetcher}
        submitting={reinspectModal.busy}
        error={reinspectModal.error}
        onClose={() => reinspectModal.setOpen(false)}
      />
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
  // "ok" in fetcher.data narrows away the People-editor intents (person-add /
  // person-remove use their own dedicated fetchers, never this hook) and
  // search-contacts, whose result shape carries no ok/error — those would
  // otherwise widen the union `fetcher.data.ok` is read from.
  const succeeded =
    fetcher.state === "idle" &&
    fetcher.data?.intent === intent &&
    "ok" in fetcher.data &&
    fetcher.data.ok;
  const error =
    fetcher.data?.intent === intent && "ok" in fetcher.data && !fetcher.data.ok
      ? fetcher.data.error
      : undefined;

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
    consent === "granted" ? m.inspections_hub_sms_granted() : consent === "revoked" ? m.inspections_hub_sms_revoked() : m.inspections_hub_sms_not_recorded();
  const tone: PillTone =
    consent === "granted" ? "sat" : consent === "revoked" ? "defect" : "neutral";

  // A heading, because every other card on this page has one and without it this
  // card read as a divider between two others. And a button rather than an 11px
  // text link, because recording that a client agreed to be texted is a claim the
  // operator stands behind — the weakest control on the page was carrying the
  // page's only legal attestation.
  return (
    <div className="space-y-2">
      <BlockHeading title={m.inspections_hub_sms_heading()} pill={{ tone, label }} />
      {consent !== "granted" && (
        <>
          <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_sms_explainer()}</p>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="attest-sms" />
            <Button type="submit" variant="secondary" size="sm" disabled={attesting}>
              {attesting ? m.inspections_hub_sms_recording() : m.inspections_hub_sms_confirm()}
            </Button>
          </fetcher.Form>
        </>
      )}
      {error && <p className="text-[12px] text-ih-bad-fg">{error}</p>}
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
      {copied ? m.inspections_hub_copied() : m.inspections_hub_copy_link()}
    </button>
  );
}

/** Shared block heading: a label plus an optional derived status pill. */
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
      ? m.inspections_hub_eb_not_found()
      : status === 403
        ? m.inspections_hub_eb_forbidden()
        : m.inspections_hub_eb_generic();

  return (
    <div className="max-w-[1080px] mx-auto pt-16 px-9 flex flex-col items-center gap-3 text-center">
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      <Link
        to="/inspections"
        className="h-9 px-4 inline-flex items-center rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600"
      >
        {m.inspections_hub_eb_back()}
      </Link>
    </div>
  );
}
