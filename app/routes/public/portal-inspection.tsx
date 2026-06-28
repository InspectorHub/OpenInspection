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
import { HubSectionSlot } from "~/components/portal/hub/HubSectionSlot";
import type { TenantBrand } from "~/lib/brand";

export function meta() {
  return [{ title: "Inspection - OpenInspection" }];
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
      onSignOut={() => void signOut(tenant)}
    />
  );
}
