import { useState, useEffect } from "react";
import { useLoaderData, Link, isRouteErrorResponse, useRouteError, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/inspector-portal";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useDisplayTimeZone, useInspectionDateTimeFormat } from "~/hooks/useSessionContext";
import {
  deriveBlockStates,
  formatCents,
  isReportShipped,
  latestPublishedAt,
  publishNotified,
  type HubPayload,
} from "~/lib/hub-blocks";
import { REPORT_STATUS, isReportPublished, humanizeStatus, statusTone } from "~/lib/status";
import { getEffectivePriceCents } from "../../server/lib/effective-price";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, Card, Pill, Button, Modal, buttonClasses } from "@core/shared-ui";
import DocumentsSection, {
  type DocumentItem,
  type DocumentCategory,
  type DocumentVisibility,
} from "~/components/DocumentsSection";
import { BlockHeading } from "~/components/inspector-portal/BlockHeading";
import { ClientSmsConsent } from "~/components/inspector-portal/ClientSmsConsent";
import { LifecycleCard } from "~/components/inspector-portal/LifecycleCard";
import { SendAgreementModal, type SendAgreementPayload } from "~/components/agreements/SendAgreementModal";
import { SigningRequests } from "~/components/inspector-portal/SigningRequests";
import { SignaturePad } from "~/components/SignaturePad";
import { RequestPaymentModal } from "~/components/inspector-portal/RequestPaymentModal";
import { PublishReportModal } from "~/components/inspector-portal/PublishReportModal";
import { CreateReinspectionModal } from "~/components/inspector-portal/CreateReinspectionModal";
import { PublishNotice } from "~/components/inspector-portal/PublishNotice";
import { PeopleEditor, type PersonRow } from "~/components/inspection/PeopleEditor";
import { SendReportModal } from "~/components/inspection/SendReportModal";
import { SendSmsModal } from "~/components/inspection/SendSmsModal";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import { publishCapFromMe, viewCommunicationCapFromMe } from "~/lib/inspector-portal-helpers";
import {
  toActionResult,
  handlePersonAdd,
  handlePersonRemove,
  handlePersonResetAccess,
  handlePersonMakePrimary,
  handleReportLinkExpiry,
  handleSearchContacts,
  handleSendAgreement,
  handleInspectorSign,
} from "~/lib/inspector-portal-actions";
import {
  handleSaveOrder,
  handleServiceAdd,
  handleServicePrice,
  handleServiceRemove,
  handleUnlockReport,
  handleRelockReport,
  handleReportDelete,
} from "~/lib/inspection-order-actions";
import { ScheduleCard, type TeamMember } from "~/components/inspector-portal/ScheduleCard";
import { ServicesCard, type CatalogService } from "~/components/inspector-portal/ServicesCard";
import { ReportsCard, type ReportRow } from "~/components/inspector-portal/ReportsCard";
import { VisitsCard } from "~/components/inspector-portal/VisitsCard";
import { loadVisits, handleVisitAdd, handleVisitStatus } from "~/lib/inspection-visits";
import { OrderDetailsCard } from "~/components/inspector-portal/OrderDetailsCard";
import { InvoiceCard } from "~/components/inspector-portal/InvoiceCard";
import { GateToggle } from "~/components/inspector-portal/GateToggle";
import { ReportGateUnlock } from "~/components/inspector-portal/ReportGateUnlock";
import { CommunicationSection } from "~/components/inspector-portal/CommunicationSection";
import { resolveReferralSources } from "../../server/lib/referral-sources";
import { versionDiffHref, type ReinspectCandidate, type ReportVersionRow } from "~/lib/inspector-portal-helpers";
import { isAdminRole } from "~/lib/access";
import { m } from "~/paraglide/messages";
import { getCloudflareEnv } from "~/lib/load-context";
import { useModalFetcher } from "~/hooks/useModalFetcher";

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
    // The order-wide gate's release record; null while still gated.
    unlockedAt: string | null;
    unlockedByName: string | null;
    unlockReason: string | null;
    date: string | null;
    inspectorId: string | null;
    templateId: string | null;
    // IA-95 — absent when the caller lacks the `financial` capability (an
    // inspector's default). Optional here so the compiler forces every render
    // site to say what it shows instead of money.
    price?: number;
    paymentStatus: string;
    coverPhoto: string | null;
    createdAt: string | null;
    // Order facts the hub owns since the settings merge — they describe the
    // order, not the report, and used to be reachable only from the editor.
    closingDate: string | null;
    referenceNumber: string | null;
    referralSource: string | null;
    referredByContactId?: string | null;
    referredByName?: string | null;
    // reportStatus is inherited from HubPayload["inspection"] but listed here for clarity
  };
  tenantSlug: string;
  people: {
    inspector: { id: string; name: string | null; email: string; phone: string | null } | null;
    client: { name: string; email: string | null; phone: string | null } | null;
    buyerAgents: PeopleAgent[];
    listingAgents: PeopleAgent[];
  };
  services: Array<{
    id: string;
    serviceId: string;
    name: string;
    // IA-95 — all three absent without the `financial` capability; the line
    // itself (what was sold) is still legitimately visible.
    priceCents?: number;
    priceSnapshot?: number;
    priceOverride?: number | null;
  }>;
  agreements: Array<{ id: string; name: string }>;
  // One order, several deliverables. Optional so an older payload still renders.
  reports?: ReportRow[];
  communication?: { delivered: number; needsAttention: number; unread: number; rulesActive: number };
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

  // Publish comes from the server's capability set (see publishCapFromMe for
  // the full story); isAdmin stays role-derived — the coarse tier is a
  // different question from a capability and has no override.
  let canPublishCap = false;
  let canViewCommunication = false;
  let isAdmin = false;
  // The raw role travels too: the Visits card decides its verbs through ONE
  // function (`visitActions`) that takes a role, so the page cannot grow a
  // second, divergent opinion about who may record lab results.
  let role = "inspector";
  const meGet = api.auth?.me?.$get as unknown as ((args?: unknown) => Promise<Response>) | undefined;
  const meRes = meGet ? await meGet().catch(() => null) : null;
  if (meRes && meRes.ok) {
    const meBody = (await meRes.json().catch(() => ({}))) as {
      data?: { user?: { role?: string }; capabilities?: { publish?: boolean; viewCommunication?: boolean } };
    };
    canPublishCap = publishCapFromMe(meBody);
    canViewCommunication = viewCommunicationCapFromMe(meBody);
    role = meBody.data?.user?.role ?? 'inspector';
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

  // Order-fact editors on the hub (IA-87 + the settings merge). All three are
  // best-effort: each degrades to an empty list, which disables the affected
  // picker rather than breaking the page.
  //  - `members`  → the Schedule card's inspector picker
  //  - `catalog`  → the Services card's "Add service" picker
  //  - `referralSources` → the Order-details referral dropdown, which the
  //    editor's settings sheet rendered but never populated (its own caller
  //    never passed the prop), so the field was unsettable from anywhere.
  // Optional-chained like the `meGet` / `peopleGet` lookups below: a narrower
  // mocked api-client in a unit test degrades to an empty list instead of
  // throwing on a missing property.
  const membersGet = api.team?.members?.$get as unknown as ((args?: unknown) => Promise<Response>) | undefined;
  const membersRes = membersGet ? await membersGet({}).catch(() => null) : null;
  const members: TeamMember[] = membersRes && membersRes.ok
    ? (((await membersRes.json()) as { data?: { members?: Array<{ id: string; name?: string | null; email?: string | null }> } })
        .data?.members ?? []).map((u) => ({ id: u.id, name: u.name ?? "", email: u.email ?? "" }))
    : [];

  const catalogGet = api.services?.index?.$get as unknown as ((args?: unknown) => Promise<Response>) | undefined;
  const catalogRes = catalogGet ? await catalogGet({}).catch(() => null) : null;
  // `defaultEventTypeSlugs` rides along: it is what makes the Visits card's add
  // picker propose a radon test's drop-off AND its pickup instead of asking the
  // user to remember that a radon job is two visits.
  const catalogRows = catalogRes && catalogRes.ok
    ? (((await catalogRes.json()) as {
        data?: Array<{ id: string; name: string; price: number; active?: boolean; defaultEventTypeSlugs?: string[] | null }>;
      }).data ?? []).filter((s) => s.active !== false)
    : [];
  const serviceCatalog: CatalogService[] = catalogRows.map((s) => ({ id: s.id, name: s.name, price: s.price }));

  const brandingGet = api.adminBranding?.branding?.$get as unknown as ((args?: unknown) => Promise<Response>) | undefined;
  const brandingRes = brandingGet ? await brandingGet({}).catch(() => null) : null;
  let customReferralSources: string[] = [];
  if (brandingRes && brandingRes.ok) {
    const body = (await brandingRes.json().catch(() => ({}))) as { data?: { branding?: { customReferralSources?: string[] } } };
    customReferralSources = body.data?.branding?.customReferralSources ?? [];
  }
  const referralSources = resolveReferralSources(customReferralSources);

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

  // The visits that make up the job (`inspection_events`), the tenant's
  // visit-type catalogue and the types this order's services imply. See
  // `~/lib/inspection-visits` for why all three hang off `api.events`.
  const { visits, visitTypes, suggestedTypeIds } = await loadVisits(
    api,
    id,
    new Set((hub.services ?? []).map((s) => s.serviceId)),
    catalogRows,
  );

  return {
    hub, smsConsent, reinspectCandidates, canPublishCap, canViewCommunication, documents, people, roleProfiles, isAdmin, versions,
    members, serviceCatalog, referralSources, visits, visitTypes, suggestedTypeIds, role,
  };
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

  // IA-65 — signing requests live on the inspection now; both intents keep
  // their bodies in inspector-portal-actions beside the People intents.
  if (intent === "send-agreement") return handleSendAgreement(api, id, formData);
  if (intent === "inspector-sign") return handleInspectorSign(api, formData);

  // IA-87 + settings merge — the order facts. `save-order` is one intent behind
  // the schedule modal, the order-details modal, the base-price modal and the
  // two delivery-gate switches: they all PATCH the same row.
  if (intent === "save-order") return handleSaveOrder(api, id, formData);
  if (intent === "service-add") return handleServiceAdd(api, id, formData);
  if (intent === "service-price") return handleServicePrice(api, id, formData);
  if (intent === "service-remove") return handleServiceRemove(api, id, formData);
  if (intent === "report-delete") return handleReportDelete(api, id, formData);
  if (intent === "unlock-report") return handleUnlockReport(api, id, formData);
  if (intent === "relock-report") return handleRelockReport(api, id);

  // The visits that make up the job. Both endpoints already existed with no
  // caller — `inspection_events` shipped with an API, an automation trigger per
  // transition, and no frontend at all, which is why production holds no rows.
  if (intent === "visit-add") return handleVisitAdd(api, id, formData);
  if (intent === "visit-status") return handleVisitStatus(api, formData);

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
  // inspector-portal-actions.ts (same extraction convention as toActionResult
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

  // Communication A3.4 — manual SMS via the shared TCPA core. Recipients are
  // contactId+roleKey only (no free-typed numbers).
  if (intent === "send-sms") {
    const recipients = JSON.parse(String(formData.get("recipients") ?? "[]"));
    const res = await api.inspections[":id"]["send-sms"].$post({
      param: { id },
      json: { recipients },
    });
    return toActionResult(res, "send-sms", m.inspections_hub_error_send_sms());
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
  const {
    hub, smsConsent, reinspectCandidates, canPublishCap, canViewCommunication, documents, people, roleProfiles, isAdmin, versions,
    members, serviceCatalog, referralSources, visits, visitTypes, suggestedTypeIds, role,
  } = useLoaderData<typeof loader>();
  // `peopleCard` is the read-only getPeopleCard() projection (client/agents/
  // inspector — still used for the header meta line + modal default emails);
  // `people` (destructured above) is the Task 3 editable inspection_people
  // list PeopleEditor renders. Two different shapes, hence the rename here.
  const { inspection, people: peopleCard, services, tenantSlug } = hub;
  const displayTz = useDisplayTimeZone();
  const fmt = useInspectionDateTimeFormat();
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
  const agreementModal = useModalFetcher<typeof action>("send-agreement");
  const paymentModal = useModalFetcher<typeof action>("request-payment");
  const publishModal = useModalFetcher<typeof action>("publish");

  // IA-65 — signer management on the inspection. The send modal serializes its
  // signer rows into the action; the pre-sign modal is keyed by envelope id
  // (which row's "Sign now" was pressed) and closes itself on success.
  const submitSendAgreement = (payload: SendAgreementPayload) => {
    agreementModal.fetcher.submit(
      {
        intent: "send-agreement",
        agreementId: payload.agreementId,
        completionPolicy: payload.completionPolicy,
        signers: JSON.stringify(payload.signers),
      },
      { method: "post" },
    );
  };

  const [preSigningId, setPreSigningId] = useState<string | null>(null);
  const preSignModal = useModalFetcher<typeof action>("inspector-sign");
  const submitPreSignature = (dataUri: string) => {
    preSignModal.fetcher.submit(
      { intent: "inspector-sign", envelopeId: preSigningId ?? "", signatureBase64: dataUri },
      { method: "post" },
    );
  };
  useEffect(() => {
    if (preSignModal.succeeded) setPreSigningId(null);
  }, [preSignModal.succeeded]);

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
  const [sendSmsOpen, setSendSmsOpen] = useState(false);
  const sendSmsFetcher = useFetcher<typeof action>();

  const reinspectModal = useModalFetcher<typeof action>("create-reinspection", { closeOnSuccess: false });
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

  // IA-95 — the server redacts money when the caller lacks the `financial`
  // capability, so ABSENCE is the signal. We deliberately do NOT ship a second
  // copy of the capability to the client to branch on: a client-side flag can
  // disagree with what the server actually sent, whereas absence cannot — it IS
  // what was sent. One source of truth, and it is the payload.
  const canSeeMoney = inspection.price !== undefined;

  // Invoice amount the SERVER will request — same money authority chain as the
  // endpoint (invoice > Σ services > inspections.price). Drives the modal amount
  // and the card's headline figure. Undefined when money is redacted.
  const invoiceAmountCents = canSeeMoney
    ? getEffectivePriceCents({
        invoiceAmountCents: hub.invoice?.amountCents ?? null,
        serviceLines: services.map((s) => ({ priceSnapshot: s.priceCents ?? 0 })),
        inspectionPriceCents: inspection.price ?? 0,
      })
    : undefined;
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
              {formatInspectionDateTime(inspection.date, undefined, displayTz, fmt)}
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

      {/* Six blocks — responsive 2-col grid (1-col on mobile).
          `items-start`: grid rows stretch their items to equal height by
          default, so a three-line Schedule card was inflated to match whatever
          sat beside it and rendered as mostly blank. Cards size to their own
          content; the columns no longer have to agree. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* Cards follow the job, not the schema: everything you settle BEFORE
            the visit, then the visit, then what happens after it. The old order
            interleaved them (status before services and agreement; invoice
            before the report it bills for), so the page had no through-line to
            read down.

            1. Schedule — when and who. Editable here: both facts describe the
            order, and the card that showed them used to send you into the
            report editor to change them. ------------------------------ */}
        <ScheduleCard
          inspectionId={inspection.id}
          date={inspection.date}
          inspectorId={inspection.inspectorId}
          inspectorName={peopleCard.inspector?.name ?? peopleCard.inspector?.email ?? null}
          members={members}
          displayTz={displayTz}
        />

        {/* 2. People — who. Editable (Plan 1B Task 5): PeopleEditor sources rows
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
            <Card className="p-4" id="client-sms-consent">
              <ClientSmsConsent
                consent={smsConsent}
                fetcher={attestSms}
                attesting={attesting}
              />
            </Card>
          )}
        </div>

        {/* 3. Services — what was sold. IA-87: the lines are editable now;
            until this card had verbs, an inspection created without services
            could never be made billable from anywhere but the report editor's
            price box. ------------------------------------------------- */}
        <ServicesCard services={services} catalog={serviceCatalog} canManage={isAdmin} />

        {/* 3a. Visits — the job as it actually happens. A radon test is a
            drop-off and a pickup two days apart; until this card existed the
            second half of the job was in the inspector's head and nowhere
            else. Sits beside Services on purpose: the visits ARE what the
            services committed the company to turning up for. -------- */}
        <VisitsCard
          visits={visits}
          visitTypes={visitTypes}
          suggestedTypeIds={suggestedTypeIds}
          role={role}
          formatDate={(iso) => formatInspectionDateTime(iso, undefined, displayTz, fmt)}
        />

        {/* 3b. Reports — what gets DELIVERED. The order-wide report pill above
            answers "is the report out"; with several deliverables on one order
            that question no longer has one answer. ------------------- */}
        <ReportsCard
          reports={hub.reports ?? []}
          canManage={isAdmin}
          formatDate={(iso) => formatInspectionDateTime(iso, undefined, displayTz, fmt)}
        />

        {/* 4. Signing requests — the paperwork the visit needs -------- */}
        <Card className="p-5">
          <BlockHeading title={m.inspections_hub_block_agreement()} pill={blocks.agreement} />
          <SigningRequests
            requests={hub.agreementRequests}
            canManageSigners={isAdmin}
            displayTz={displayTz}
            onSend={() => agreementModal.setOpen(true)}
            onPreSign={setPreSigningId}
          />
          {/* The gate that decides whether a signature is required at all. It
              was a checkbox in the report editor's settings sheet; it belongs
              with the agreements it gates. */}
          <GateToggle
            field="agreementRequired"
            checked={inspection.agreementRequired}
            label={m.inspections_hub_gate_agreement()}
            testId="hub-gate-agreement"
          />
        </Card>

        {/* 5. Inspection status — the visit itself. Independent of report
            publishing. */}
        <LifecycleCard status={inspection.status} inspectionId={inspection.id} fetcher={completeInspection} />

        {/* 5b. Communication — what has been said, and what we sent. The
            client already had a Messages tab; this is the inspector's first
            surface for the same conversation (IA-105), plus the Outbox that
            answers "did the agent get the report" without opening email.
            Gated on the SERVER's viewCommunication bit (§7.5 item 1): the
            payload endpoint 403s a withdrawn viewer, so rendering the card
            would only produce a section whose every expand errors. */}
        {canViewCommunication && (
          <CommunicationSection
            inspectionId={inspection.id}
            counts={hub.communication ?? { delivered: 0, needsAttention: 0, unread: 0, rulesActive: 0 }}
            reportPublished={reportShipped}
            threadOptions={people.map((p) => ({ contactId: p.contactId, name: p.name, roleLabel: p.roleLabel ?? null }))}
            onGetConsent={() => document.getElementById("client-sms-consent")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          />
        )}

        {/* 6. Report — the deliverable ------------------------------- */}
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
                      date: formatInspectionDateTime(new Date(publishedAt * 1000).toISOString(), undefined, displayTz, fmt),
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
                {canPublishCap && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSendSmsOpen(true)}
                  >
                    {m.inspections_hub_report_send_sms()}
                  </Button>
                )}
                {/* #69 — HERE, on the singular REPORT card, not on the plural
                    REPORTS card. An order can have a published report and an
                    EMPTY deliverables list, and the log then sat under the
                    words "No reports on this order yet". This block is already
                    inside `reportShipped`, which is the log's own precondition. */}
                <Link
                  to={`/inspections/${inspection.id}/repair-requests`}
                  data-testid="hub-repair-log-link"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  {m.inspections_hub_report_repair_log()}
                </Link>
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
              {inspection.reportStatus === REPORT_STATUS.SUBMITTED && (
                <p className="text-[12px] text-ih-fg-3 mb-3">
                  {m.inspections_hub_report_submitted()}
                </p>
              )}
              {inspection.reportStatus === REPORT_STATUS.IN_PROGRESS && hub.publishReadiness.ready && (
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
                              {formatInspectionDateTime(new Date(v.publishedAt * 1000).toISOString(), undefined, displayTz, fmt)}
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

          {/* The order-wide gate's release. It belongs on the REPORT card by the
              same rule GateToggle follows — the card for the artifact it gates —
              and the artifact here is the reports, plural. Admin-only: this
              hands a client something the tenant's own rules said to hold. */}
          {isAdmin && (
            <ReportGateUnlock
              unlockedAt={inspection.unlockedAt ?? null}
              unlockedByName={inspection.unlockedByName ?? null}
              unlockReason={inspection.unlockReason ?? null}
              formatDate={(iso) => formatInspectionDateTime(iso, undefined, displayTz, fmt)}
            />
          )}
        </Card>
        {/* 7. Invoice — getting paid for it. IA-87 ②: the amount was display
            only; the base price is editable here when nothing outranks it. */}
        <InvoiceCard
          pill={blocks.invoice}
          amountCents={invoiceAmountCents}
          currency={hub.invoice?.currency}
          paid={invoicePaid}
          sent={invoiceSent}
          payUrl={hub.invoice?.payUrl}
          hasServiceLines={services.length > 0}
          paymentRequired={inspection.paymentRequired}
          basePriceCents={inspection.price}
          canManagePrice={isAdmin && canSeeMoney}
          onRequestPayment={() => paymentModal.setOpen(true)}
        />

        {/* 8. Order details — the back-office facts. Last on purpose: nobody
            opens the hub to read a referral source. --------------------- */}
        <OrderDetailsCard
          closingDate={inspection.closingDate}
          referenceNumber={inspection.referenceNumber}
          referralSource={inspection.referralSource}
          referralSources={referralSources}
          referredByContactId={inspection.referredByContactId ?? null}
          referredByName={inspection.referredByName ?? null}
        />

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

      {/* Send-agreement modal — the shared multi-signer modal (IA-65). Seeded
          with the inspection's primary client so the single-signer case stays
          one click, but a co-client or agent can be added without leaving. */}
      <SendAgreementModal
        open={agreementModal.open}
        templates={hub.agreements}
        initialSigners={
          peopleCard.client?.email
            ? [{ name: peopleCard.client.name || peopleCard.client.email, email: peopleCard.client.email, role: "client" }]
            : undefined
        }
        busy={agreementModal.busy}
        onSend={submitSendAgreement}
        onClose={() => agreementModal.setOpen(false)}
      />
      {agreementModal.error && (
        <p className="text-[12px] font-medium text-ih-bad-fg">{agreementModal.error}</p>
      )}

      {/* Inspector pre-sign — the envelope-level signature an inspector applies
          before the client sees it. Moved off the Library page with the rest of
          signer management (IA-65). */}
      <Modal
        open={!!preSigningId}
        onClose={() => setPreSigningId(null)}
        title={m.library_agreements_sign_title()}
      >
        <p className="text-sm text-ih-fg-3 mb-4">{m.library_agreements_sign_desc()}</p>
        <SignaturePad
          onSubmit={submitPreSignature}
          onCancel={() => setPreSigningId(null)}
          label={m.library_agreements_save_signature()}
        />
        {preSignModal.error && <p className="text-sm text-ih-bad-fg mt-3">{preSignModal.error}</p>}
      </Modal>

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

      {sendSmsOpen && (
        <SendSmsModal
          people={people}
          fetcher={sendSmsFetcher}
          onClose={() => setSendSmsOpen(false)}
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
