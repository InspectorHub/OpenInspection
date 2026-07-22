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
import { useState } from "react";
import type { Route } from "./+types/portal-inspection";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND } from "~/lib/brand";
import { formatInspectionDateTime } from "~/lib/format-date";
import InspectionHub, {
  hubSectionNavHref,
  type HubSection,
} from "~/components/portal/InspectionHub";
import { signOut } from "~/components/portal/sign-out";
import type { StatusOverview } from "~/components/portal/InspectionStatusCards";
import type {
  DocumentItem,
  DocumentCategory,
  DocumentVisibility,
} from "~/components/DocumentsSection";
import type { ReportLoaderResult } from "~/components/portal/sections/ReportView";
import type { LoaderResult as RepairLoaderResult } from "~/components/portal/sections/RepairBuilderSection";
import {
  parseSection,
  isJumpSection,
  loadReportSection,
  loadProgressSection,
  loadRepairSection,
  loadInvoiceSection,
  loadAgreementSection,
  type ProgressLoaderResult,
  type InvoiceLoaderResult,
  type AgreementLoaderResult,
} from "~/lib/section-loaders";
import { loadAgentReportContext, type AgentReportContext } from "~/lib/agent-report-context";
import { resolvePortalSession } from "~/lib/portal-exchange";
import { HubSectionSlot } from "~/components/portal/hub/HubSectionSlot";
import type { TenantBrand } from "~/lib/brand";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.portal_inspection_meta_title() }];
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
  let section = parseSection(url.searchParams.get("section"));

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

  // Steps 1+2 (token exchange + overview) live in ~/lib/portal-exchange —
  // extracted purely to keep this route file under the file-size ratchet.
  // Task 6: `isAgentToken` short-circuits the session-gated overview call
  // entirely (an agent token never mints `__Host-portal_session`) and forces
  // the report section below, since agents have no client hub.
  const { overview: resolvedOverview, overviewToken, signerToken, isAgentToken, cookieToForward, cookieForApi } =
    await resolvePortalSession(context, api, tenant, inspectionId, token, browserCookie);
  let overview = resolvedOverview;
  if (isAgentToken) section = "report";

  // Prefer the server-issued persistent per-inspection token (always present for
  // an accessible inspection, including magic-link sessions that carry no
  // ?token); fall back to the URL ?token (email-CTA arrival, and the ONLY
  // source for an agent token — overviewToken is never set on that path) then "".
  const ctxToken = overviewToken || token || "";
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
      const apiWorker = context.cloudflare.env.API_WORKER;
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

  // Backfill the minimal agent overview stand-in's .address/.date (the only
  // fields InspectionHub reads off `overview` on a non-overview section) from
  // the just-fetched, token-scoped report — never from the session-gated
  // overview endpoint, which agent tokens never call (see Step 2 above).
  if (isAgentToken && report) {
    overview = {
      ...overview,
      address: report.address || overview.address,
      date: report.date || overview.date,
      reportPublished: report.isPublished ?? overview.reportPublished,
    };
  }

  // Humanize the raw inspection date once, server-side. Both the normal overview
  // and the agent stand-in carry inspections.date as a raw ISO/date string; the
  // Hub header + status cards would otherwise show a bare timestamp
  // (2026-07-20T00:27:12.605Z). Format in the TENANT timezone — the anchor for
  // portal/report surfaces — and do it in the loader so the formatted string is
  // serialized loader data (no client re-format, so no hydration mismatch).
  if (overview.date) {
    overview = { ...overview, date: formatInspectionDateTime(overview.date, undefined, brand.defaultTimezone) };
  }

  // Same treatment for the Progress section header date — loadProgressSection
  // returns the raw inspections.date; format it in the tenant timezone here so
  // <ProgressView> receives an already-humanized string (never a bare ISO).
  if (progress?.date) {
    progress = { ...progress, date: formatInspectionDateTime(progress.date, undefined, brand.defaultTimezone) };
  }

  // Step 4b — agent report-landing context (Spec 3 Task 3): resolves whether
  // ctx.token's recipient is an agent and, if so, whether they already have a
  // global agent account — the Report section CTA (magic-login vs signup)
  // branches on this. See loadAgentReportContext for the best-effort fetch.
  const agentReport = await loadAgentReportContext(context, tenant, inspectionId, ctx.token);

  // Step 5 — render the hub.
  return new Response(
    JSON.stringify({ overview, ctx, section, brand, documents, report, progress, repair, invoice, agreement, agentReport }),
    {
      headers: {
        "Content-Type": "application/json",
        ...(cookieToForward ? { "Set-Cookie": cookieToForward } : {}),
      },
    },
  );
}

/* ------------------------------------------------------------------ */
/* Action — Spec 3 Task 3 "Go to my workspace" BFF relay.               */
/* BFF ONLY (feedback_core_bff_no_client_fetch): <AgentReportActions>   */
/* posts the "agent-magic-login" intent via useFetcher, which hits THIS */
/* action rather than a client `fetch('/api/...')`. Mirrors the         */
/* Commercial PCA Phase W Task 6 WordExportButton/report-card-stack.tsx */
/* action pattern (intent-dispatch, createApi(context) relay).          */
/* ------------------------------------------------------------------ */

type AgentMagicLoginActionResult =
  | { ok: true; intent: "agent-magic-login"; sent: boolean }
  | { ok: false; intent: "agent-magic-login"; error?: string }
  | { ok: false; intent: string };

export async function action({ request, params, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const tenant = params.tenant ?? "";
  const inspectionId = params.inspectionId ?? "";

  if (intent === "agent-magic-login") {
    const token = String(formData.get("token") ?? "");
    const api = createApi(context);
    try {
      const res = (await api.agentMagicLogin["magic-login"].request.$post({
        json: { tenant, inspectionId, token },
      })) as unknown as Response;
      if (!res.ok) {
        return { ok: false, intent: "agent-magic-login" } satisfies AgentMagicLoginActionResult;
      }
      const body = (await res.json()) as { data?: { sent?: boolean } };
      return {
        ok: true,
        intent: "agent-magic-login",
        sent: body.data?.sent ?? true,
      } satisfies AgentMagicLoginActionResult;
    } catch {
      return { ok: false, intent: "agent-magic-login" } satisfies AgentMagicLoginActionResult;
    }
  }

  return { ok: false, intent: String(intent ?? "") } satisfies AgentMagicLoginActionResult;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function PortalInspection() {
  const { overview, ctx, section, brand, documents, report, progress, repair, invoice, agreement, agentReport } = useLoaderData<typeof loader>() as {
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
    agentReport: AgentReportContext | null;
  };
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const { tenant, inspectionId, token } = ctx;
  // Spec 3: an agent report link is token-only (no client session) and the
  // server forces section='report'. Drive the hub's agent-mode chrome (hide the
  // client-only tab bar, Sign out, and in-report client actions) off the same
  // flag HubSectionSlot uses for the AgentReportActions CTA.
  const isAgent = agentReport?.kind === "agent";

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
        setDocError(m.portal_inspection_doc_upload_error());
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError(m.portal_inspection_doc_upload_error());
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
        setDocError(m.portal_inspection_doc_delete_error());
        return;
      }
      revalidator.revalidate();
    } catch {
      setDocError(m.portal_inspection_doc_delete_error());
    }
  };

  const sectionSlot = (
    <HubSectionSlot
      section={section}
      tenant={tenant}
      inspectionId={inspectionId}
      token={token}
      signerToken={ctx.signerToken}
      tokenSuffix={tokenSuffix}
      justPaid={justPaid}
      documents={documents}
      report={report}
      progress={progress}
      repair={repair}
      invoice={invoice}
      agreement={agreement}
      agentReport={agentReport}
      docUploading={docUploading}
      docError={docError}
      onUpload={onUpload}
      onDelete={onDelete}
    />
  );

  return (
    <InspectionHub
      overview={overview}
      ctx={ctx}
      brand={brand}
      activeSection={section}
      sectionSlot={sectionSlot}
      agentMode={isAgent}
      onSignOut={isAgent ? undefined : () => void signOut(tenant)}
    />
  );
}
