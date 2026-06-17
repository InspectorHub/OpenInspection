/**
 * Unified client portal — per-inspection Hub.
 *
 * Route: /portal/:tenant/:inspectionId?token=&section=&to=
 *   - ?token   : a per-inspection access token (email CTA). If present we exchange
 *     it for a portal session cookie (forwarded to the browser) so a client
 *     arriving from email lands authenticated.
 *   - ?section : which Hub section to render INLINE (phase ②+). Defaults to
 *     "overview". Client-side <Link> nav switches this without a full reload;
 *     the loader re-runs and lazily fetches only the active section's data.
 *   - ?to      : optional HubSection — redirect to the Hub with that section
 *     active inline (i.e. ?section=<to>, carrying the token + freshly-minted
 *     session cookie). Email CTAs use ?to so clients land on a clean ?section URL.
 *
 * Per-section data (decision C): always fetch the cheap overview (header +
 * status cards), then LAZILY fetch ONLY the active section's payload.
 *
 * Cookie forwarding (both directions):
 *   - exchange/redeem RESPONSE Set-Cookie → forwarded to the browser.
 *   - browser cookie (or the freshly-issued one) → forwarded INTO the overview
 *     call, since the typed client does not auto-forward the browser cookie.
 */
import { redirect, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import type React from "react";
import { useState } from "react";
import type { Route } from "./+types/portal-inspection";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND } from "~/lib/brand";
import InspectionHub, {
  hubSectionNavHref,
  type HubSection,
} from "~/components/portal/InspectionHub";
import { signOut } from "~/components/portal/sign-out";
import type { StatusOverview } from "~/components/portal/InspectionStatusCards";
import DocumentsSection, {
  type DocumentItem,
  type DocumentCategory,
  type DocumentVisibility,
} from "~/components/DocumentsSection";
import {
  ReportView,
  reportViewProps,
  type ReportLoaderResult,
  type FilterKey,
} from "~/components/portal/sections/ReportView";
import {
  ProgressView,
  type ProgressSection,
} from "~/components/portal/sections/ProgressView";
import {
  RepairBuilderSection,
  type LoaderResult as RepairLoaderResult,
  type Defect as RepairDefect,
  type RepairRequest,
} from "~/components/portal/sections/RepairBuilderSection";
import { MessagesSection } from "~/components/portal/sections/MessagesSection";
import {
  AgreementSection,
  type AgreementData,
} from "~/components/portal/sections/AgreementSection";
import {
  PaymentSection,
  type InvoiceData,
} from "~/components/portal/sections/PaymentSection";
import type { TenantBrand } from "~/lib/brand";

export function meta() {
  return [{ title: "Inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/* Section validation */
/* ------------------------------------------------------------------ */

const HUB_SECTIONS: HubSection[] = [
  "overview",
  "report",
  "agreement",
  "payment",
  "progress",
  "messages",
  "repair",
  "documents",
];

function parseSection(v: string | null): HubSection {
  return v !== null && (HUB_SECTIONS as string[]).includes(v) ? (v as HubSection) : "overview";
}

// Sections the ?to= email-CTA may jump to (every real Hub section except the
// default "overview", which needs no redirect).
function isJumpSection(v: string | null): v is HubSection {
  return v !== null && v !== "overview" && (HUB_SECTIONS as string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Report section data — mirrors the standalone report loader mapping,
 * authenticated with the portal per-inspection token (ctx.token). */
/* ------------------------------------------------------------------ */

async function loadReportSection(
  context: Route.LoaderArgs["context"],
  request: Request,
  tenant: string,
  inspectionId: string,
  token: string,
): Promise<ReportLoaderResult> {
  const parsedUrl = new URL(request.url);
  const baseUrl = parsedUrl.origin;
  const initialFilter: FilterKey = "all";
  const printMode = false;
  try {
    const api = createApi(context);
    const [res, brand] = await Promise.all([
      api.publicReport.report[":tenant"][":id"].$get({
        param: { tenant, id: inspectionId },
        query: { token: token || undefined },
      }),
      resolveTenantBrand(context, tenant),
    ]);
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as unknown as ReportLoaderResult | undefined;
    const meta = d as unknown as {
      inspection?: { propertyAddress?: string | null; date?: string | null; inspectorName?: string | null };
      theme?: string;
    } | undefined;
    const raw = d as unknown as Record<string, unknown> | undefined;
    return {
      inspectionId: d?.inspectionId ?? inspectionId,
      address: d?.address ?? meta?.inspection?.propertyAddress ?? "",
      date: d?.date ?? meta?.inspection?.date ?? "",
      inspectorName: d?.inspectorName ?? meta?.inspection?.inspectorName ?? null,
      coverPhotoUrl: d?.coverPhotoUrl ?? null,
      stats: d?.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
      sections: d?.sections ?? [],
      showEstimates: d?.showEstimates ?? false,
      enableRepairList: d?.enableRepairList ?? false,
      enableCustomerRepairExport: d?.enableCustomerRepairExport ?? false,
      isDelivered: d?.isDelivered ?? false,
      brand,
      error: res.ok ? null : "Report not found",
      notPublished: (res.status as number) === 403,
      reportTheme: (raw?.reportTheme as string | undefined) ?? meta?.theme,
      initialFilter,
      printMode,
      isPublished: (raw?.isPublished as boolean | undefined) ?? false,
      signature: (raw?.signature as ReportLoaderResult["signature"] | undefined) ?? null,
      verification: (raw?.verification as ReportLoaderResult["verification"] | undefined) ?? null,
      ownerPreview: false,
      baseUrl,
    } satisfies ReportLoaderResult;
  } catch {
    return {
      inspectionId,
      address: "",
      date: "",
      inspectorName: null,
      coverPhotoUrl: null,
      stats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
      sections: [],
      showEstimates: false,
      enableRepairList: false,
      enableCustomerRepairExport: false,
      isDelivered: false,
      brand: EMPTY_BRAND,
      error: "Service unavailable",
      notPublished: false,
      initialFilter,
      printMode,
      isPublished: false,
      signature: null,
      verification: null,
      ownerPreview: false,
      baseUrl,
    } satisfies ReportLoaderResult;
  }
}

/* ------------------------------------------------------------------ */
/* Progress section data — served via the portal-session-authed observe
 * endpoint (membership-checked), NOT the observer-link token. The portal
 * client is already authenticated by the __Host-portal_session cookie, which
 * is forwarded into the API call exactly like the overview call. */
/* ------------------------------------------------------------------ */

interface ProgressLoaderResult {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: ProgressSection[];
  error: string | null;
}

async function loadProgressSection(
  context: Route.LoaderArgs["context"],
  tenant: string,
  inspectionId: string,
  cookieForApi: string,
): Promise<ProgressLoaderResult> {
  try {
    const api = createApi(context);
    const res = await api.portal[":tenant"].inspections[":inspectionId"].observe.$get(
      { param: { tenant, inspectionId } },
      { headers: { Cookie: cookieForApi } },
    );
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    const has = Object.keys(d).length > 0;
    return {
      address: (d.address as string | undefined) ?? "",
      date: (d.date as string | null | undefined) ?? null,
      inspectorName: (d.inspectorName as string | undefined) ?? "",
      status: (d.status as string | undefined) ?? "",
      sections: (d.sections as ProgressSection[] | undefined) ?? [],
      error: res.ok && has ? null : "Inspection not found",
    };
  } catch {
    return {
      address: "",
      date: null,
      inspectorName: "",
      status: "",
      sections: [],
      error: "Service unavailable",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Repair section data — mirrors the standalone repair-builder loader mapping,
 * authenticated with the portal per-inspection token (ctx.token). */
/* ------------------------------------------------------------------ */

async function loadRepairSection(
  context: Route.LoaderArgs["context"],
  tenant: string,
  inspectionId: string,
  token: string,
): Promise<RepairLoaderResult> {
  try {
    const api = createApi(context);
    const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].source.$get({
      param: { tenant, id: inspectionId },
      query: { token: token || undefined },
    });

    if (res.status === 401) return { kind: "no_access" };
    if (res.status === 403) {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body?.error?.code === "NOT_PUBLISHED") return { kind: "not_published" };
      return { kind: "forbidden" };
    }
    if (!res.ok) return { kind: "error" };

    const body = (await res.json()) as {
      data?: { defects: RepairDefect[]; mine: RepairRequest[] };
    };
    const data = body.data;
    if (!data) return { kind: "error" };

    return {
      kind: "ok",
      defects: data.defects,
      mine: data.mine,
      tenant,
      id: inspectionId,
      token: token || null,
    };
  } catch {
    return { kind: "error" };
  }
}

/* ------------------------------------------------------------------ */
/* Payment section data — mirrors the standalone invoice loader mapping.
 * The pay flow is keyed by INSPECTION ID (pay-intent + invoice both by id),
 * so no per-inspection token is required here. */
/* ------------------------------------------------------------------ */

interface InvoiceLoaderResult {
  invoice: InvoiceData | null;
  brand: TenantBrand;
  error: string | null;
}

/** Wire shape of GET /api/public/inspections/:id/invoice (cents + ISO dates + brand). */
interface RawInvoice {
  id: string;
  amountCents: number;
  status: string;
  createdAt?: string | null;
  dueDate?: string | null;
  clientName?: string | null;
  lineItems?: { description: string; amountCents: number }[];
  brand?: TenantBrand;
}

async function loadInvoiceSection(
  context: Route.LoaderArgs["context"],
  inspectionId: string,
): Promise<InvoiceLoaderResult> {
  try {
    const api = createApi(context);
    const res = await api.publicReport.inspections[":id"].invoice.$get({ param: { id: inspectionId } });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? null) as RawInvoice | null;
    const invoice: InvoiceData | null = d
      ? {
          number: `INV-${d.id.slice(0, 8).toUpperCase()}`,
          date: d.createdAt?.slice(0, 10) ?? "",
          dueDate: d.dueDate ?? null,
          status: (d.status as InvoiceData["status"]) ?? "draft",
          clientName: d.clientName ?? "",
          inspectorName: "",
          lineItems: (d.lineItems ?? []).map((li) => ({ description: li.description, amount: li.amountCents / 100 })),
          total: d.amountCents / 100,
        }
      : null;
    return {
      invoice,
      brand: d?.brand ?? EMPTY_BRAND,
      error: res.ok ? null : "Invoice not found",
    };
  } catch {
    return { invoice: null, brand: EMPTY_BRAND, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/* Agreement section data — mirrors the standalone agreement-sign loader.
 * Fetched with the recipient's OWN email-matched signer token (NOT the
 * per-inspection access token). The overview endpoint resolves that token
 * server-side (email-matched, never cross-signer). A null signerToken means the
 * recipient is not a signer → no agreement to render. */
/* ------------------------------------------------------------------ */

interface AgreementLoaderResult {
  agreement: AgreementData | null;
  error: string | null;
}

async function loadAgreementSection(
  context: Route.LoaderArgs["context"],
  signerToken: string | null,
): Promise<AgreementLoaderResult> {
  if (!signerToken) return { agreement: null, error: null };
  try {
    const api = createApi(context);
    const res = (await api.bookings.agreements[":token"].$get({
      param: { token: signerToken },
    })) as unknown as Response;
    const body = res.ok ? ((await res.json()) as { data?: AgreementData }) : {};
    const d = (body as { data?: AgreementData }).data ?? null;
    return { agreement: d, error: res.ok ? null : "Agreement not found" };
  } catch {
    return { agreement: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const tenant = params.tenant ?? "";
  const inspectionId = params.inspectionId ?? "";
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const to = url.searchParams.get("to");
  const section = parseSection(url.searchParams.get("section"));

  const api = createApi(context);
  const browserCookie = request.headers.get("cookie") ?? "";

  // Tenant brand for the Hub shell (logo / company name / accent). Best-effort:
  // any failure degrades to the platform default (EMPTY_BRAND).
  let brand: TenantBrand = EMPTY_BRAND;
  try {
    brand = await resolveTenantBrand(context, tenant);
  } catch {
    brand = EMPTY_BRAND;
  }

  // Cookie to forward to the browser (only set if exchange minted a fresh one).
  let cookieToForward: string | null = null;
  // Cookie value to present to the overview call: prefer the freshly-issued one.
  let cookieForApi = browserCookie;

  // Step 1 — if a per-inspection token is present, try to upgrade it into a
  // portal session. Failure is non-fatal: an existing session may still work.
  if (token) {
    try {
      const ex = await api.portal[":tenant"].exchange.$get({
        param: { tenant },
        query: { token, inspectionId },
      });
      if (ex.status === 200) {
        const minted = ex.headers.get("set-cookie");
        if (minted) {
          // Forward the FULL Set-Cookie value to the browser (it carries
          // ; Path=/; HttpOnly; Secure; SameSite=Lax attributes).
          cookieToForward = minted;
          // A Cookie request header must be `name=value` only — slice off the
          // attributes before reusing the minted cookie on the same-request
          // overview call. Fall back to the incoming browser cookie.
          const mintedCookiePair = minted.split(";")[0];
          cookieForApi = mintedCookiePair || browserCookie;
        }
      }
    } catch {
      // ignore — fall through to step 2
    }
  }

  // Step 2 — fetch the overview, forwarding the (possibly freshly-issued) cookie.
  let overview: StatusOverview;
  try {
    const res = await api.portal[":tenant"].inspections[":inspectionId"].overview.$get(
      { param: { tenant, inspectionId } },
      { headers: { Cookie: cookieForApi } },
    );
    if (res.status === 401) {
      throw redirect(`/portal/${tenant}`);
    }
    if (res.status === 403 || res.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    if (!res.ok) {
      throw new Response("Not found", { status: 404 });
    }
    const body = (await res.json()) as {
      data?: StatusOverview & { token?: string; signerToken?: string | null };
    };
    if (!body.data) throw new Response("Not found", { status: 404 });
    overview = body.data;
  } catch (err) {
    if (err instanceof Response) throw err;
    throw new Response("Not found", { status: 404 });
  }

  // Prefer the server-issued persistent per-inspection token (always present for
  // an accessible inspection, including magic-link sessions that carry no
  // ?token); fall back to the URL ?token (email-CTA arrival) then "".
  const overviewToken = (overview as StatusOverview & { token?: string }).token;
  const ctxToken = overviewToken || token || "";
  const signerToken =
    (overview as StatusOverview & { signerToken?: string | null }).signerToken ?? null;
  const ctx = { tenant, inspectionId, token: ctxToken, signerToken };

  // Step 3 — if ?to names a real Hub section, jump straight to the Hub with that
  // section active INLINE (carrying the token), forwarding any freshly-issued
  // session cookie. Email CTAs use ?to so the URL the client lands on is a clean
  // ?section= Hub URL rather than a ?to= one.
  if (isJumpSection(to)) {
    throw redirect(hubSectionNavHref(to, ctx), {
      headers: cookieToForward ? { "Set-Cookie": cookieToForward } : undefined,
    });
  }

  // Step 4 — lazily fetch ONLY the active section's data (decision C).
  let documents: DocumentItem[] | null = null;
  let report: ReportLoaderResult | null = null;
  let progress: ProgressLoaderResult | null = null;
  let repair: RepairLoaderResult | null = null;
  let invoice: InvoiceLoaderResult | null = null;
  let agreement: AgreementLoaderResult | null = null;

  if (section === "documents") {
    // Client documents (unified portal section ⑦) — fetch using the SAME cookie
    // value used for the overview call. Best-effort: a non-OK response → empty.
    documents = [];
    try {
      const apiWorker = (context.cloudflare.env as unknown as { API_WORKER?: { fetch: typeof fetch } })
        .API_WORKER;
      const docsRes = await (apiWorker?.fetch ?? fetch)(
        new Request(`https://internal/api/public/inspections/${inspectionId}/documents`, {
          headers: { cookie: cookieForApi },
        }),
      );
      if (docsRes.ok) {
        documents = (((await docsRes.json()) as { data?: DocumentItem[] }).data ?? []) as DocumentItem[];
      }
    } catch {
      // Best-effort: fail open to empty list
    }
  } else if (section === "report") {
    report = await loadReportSection(context, request, tenant, inspectionId, ctxToken);
  } else if (section === "progress") {
    // Portal-session-authed (membership-checked) — forward the same cookie used
    // for the overview call rather than the observer-link token.
    progress = await loadProgressSection(context, tenant, inspectionId, cookieForApi);
  } else if (section === "repair") {
    repair = await loadRepairSection(context, tenant, inspectionId, ctxToken);
  } else if (section === "payment") {
    // Pay flow is keyed by inspection id (pay-intent + invoice) — no token.
    invoice = await loadInvoiceSection(context, inspectionId);
  } else if (section === "agreement") {
    // Uses the recipient's OWN email-matched signer token (from the overview).
    agreement = await loadAgreementSection(context, signerToken);
  }

  // Step 5 — render the hub.
  return new Response(
    JSON.stringify({ overview, ctx, section, brand, documents, report, progress, repair, invoice, agreement }),
    {
      headers: {
        "Content-Type": "application/json",
        ...(cookieToForward ? { "Set-Cookie": cookieToForward } : {}),
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function PortalInspection() {
  const { overview, ctx, section, brand, documents, report, progress, repair, invoice, agreement } = useLoaderData<typeof loader>() as {
    overview: StatusOverview;
    ctx: { tenant: string; inspectionId: string; token: string; signerToken: string | null };
    section: HubSection;
    brand: TenantBrand;
    documents: DocumentItem[] | null;
    report: ReportLoaderResult | null;
    progress: ProgressLoaderResult | null;
    repair: RepairLoaderResult | null;
    invoice: InvoiceLoaderResult | null;
    agreement: AgreementLoaderResult | null;
  };
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const { tenant, inspectionId, token } = ctx;

  // After Stripe's confirmPayment redirect the Hub reloads with
  // ?redirect_status=succeeded. The webhook settles the invoice asynchronously,
  // so show an optimistic "received" state (Pay button hidden) until the loader
  // picks up the settled invoice on a later visit — mirrors invoice.tsx.
  const justPaid = searchParams.get("redirect_status") === "succeeded";

  // Client-side upload/delete against the public document routes. The client is
  // authenticated by the __Host-portal_session cookie (auto-sent same-origin);
  // the token query is a harmless fallback included only when non-empty.
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : "";

  const onUpload = async (
    file: File,
    opts: { category: DocumentCategory; visibility: DocumentVisibility; label?: string },
  ) => {
    setDocError(null);
    setDocUploading(true);
    try {
      // Client uploads are always client_visible server-side — no visibility param.
      const qs = new URLSearchParams({
        filename: file.name,
        category: opts.category,
        ...(opts.label ? { label: opts.label } : {}),
        ...(token ? { token } : {}),
      });
      const res = await fetch(
        `/api/public/inspections/${inspectionId}/documents?${qs}`,
        {
          method: "PUT",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "content-length": String(file.size),
          },
          body: file,
        },
      );
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

  const onDelete = async (docId: string) => {
    setDocError(null);
    try {
      const res = await fetch(
        `/api/public/inspections/${inspectionId}/documents/${docId}${tokenSuffix}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setDocError("Could not delete the document. Please try again.");
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError("Could not delete the document. Please try again.");
    }
  };

  // Build the active section's body (decision B/C). Overview renders the status
  // cards inside the Hub itself; this slot is only used on non-overview tabs.
  let sectionSlot: React.ReactNode = null;
  if (section === "documents") {
    sectionSlot = (
      <DocumentsSection
        items={documents ?? []}
        canUpload
        showVisibilityToggle={false}
        downloadHref={(docId) =>
          `/api/public/inspections/${inspectionId}/documents/${docId}${tokenSuffix}`
        }
        onUpload={onUpload}
        onDelete={onDelete}
        uploading={docUploading}
        error={docError}
      />
    );
  } else if (section === "report" && report) {
    sectionSlot = (
      <ReportView
        {...reportViewProps({
          ...report,
          tenant,
          inspectionId,
          token: token || undefined,
        })}
      />
    );
  } else if (section === "progress" && progress) {
    sectionSlot = (
      <ProgressView
        address={progress.address}
        date={progress.date}
        inspectorName={progress.inspectorName}
        status={progress.status}
        sections={progress.sections}
        error={progress.error}
      />
    );
  } else if (section === "repair" && repair) {
    sectionSlot = (
      <RepairBuilderSection
        result={repair}
        actionPath={`/repair-builder/${tenant}/${inspectionId}`}
      />
    );
  } else if (section === "payment" && invoice) {
    sectionSlot = (
      <PaymentSection
        invoice={invoice.invoice}
        brand={invoice.brand}
        inspectionId={inspectionId}
        error={invoice.error}
        justPaid={justPaid}
      />
    );
  } else if (section === "agreement") {
    sectionSlot = (
      <AgreementSection
        agreement={agreement?.agreement ?? null}
        error={agreement?.error ?? null}
        tenant={tenant}
        token={ctx.signerToken ?? ""}
        actionPath={`/agreements/sign/${tenant}/${ctx.signerToken ?? ""}`}
      />
    );
  } else if (section === "messages") {
    sectionSlot = (
      <MessagesSection inspectionId={inspectionId} token={token || undefined} />
    );
  }

  return (
    <InspectionHub
      overview={overview}
      ctx={ctx}
      brand={brand}
      activeSection={section}
      sectionSlot={sectionSlot}
      onSignOut={() => void signOut(tenant)}
    />
  );
}
