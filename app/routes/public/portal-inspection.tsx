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
 *   - ?to      : optional HubSection — jump straight to that section's interim
 *     deep-link (carrying the token), instead of rendering the hub. Transitional
 *     (removed in a later task).
 *
 * Per-section data (decision C): always fetch the cheap overview (header +
 * status cards), then LAZILY fetch ONLY the active section's payload.
 *
 * Cookie forwarding (both directions):
 *   - exchange/redeem RESPONSE Set-Cookie → forwarded to the browser.
 *   - browser cookie (or the freshly-issued one) → forwarded INTO the overview
 *     call, since the typed client does not auto-forward the browser cookie.
 */
import { redirect, useLoaderData, useRevalidator } from "react-router";
import type React from "react";
import { useState } from "react";
import type { Route } from "./+types/portal-inspection";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND } from "~/lib/brand";
import InspectionHub, {
  hubSectionHref,
  type HubSection,
} from "~/components/portal/InspectionHub";
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

// Sections that are NOT yet inlined — they fall through to a transitional
// "Coming soon — open the full page" link (built from the interim deep-link).
const NOT_YET_INLINED: HubSection[] = [
  "agreement",
  "payment",
  "progress",
  "messages",
  "repair",
];

// HubSections that have an interim deep-link target. Used to validate the ?to
// query (transitional; removed in a later task).
const DEEP_LINK_SECTIONS: HubSection[] = [
  "report",
  "agreement",
  "payment",
  "progress",
  "messages",
  "repair",
];

function isDeepLinkSection(v: string | null): v is HubSection {
  return v !== null && (DEEP_LINK_SECTIONS as string[]).includes(v);
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
      messageToken: d?.messageToken ?? null,
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
      messageToken: null,
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
      data?: StatusOverview & { token?: string };
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
  const ctx = { tenant, inspectionId, token: ctxToken };

  // Step 3 — if ?to names a real deep-link section, jump straight there
  // (carrying the token), forwarding any freshly-issued session cookie.
  // Transitional: removed in a later task.
  if (isDeepLinkSection(to)) {
    throw redirect(hubSectionHref(to, ctx), {
      headers: cookieToForward ? { "Set-Cookie": cookieToForward } : undefined,
    });
  }

  // Step 4 — lazily fetch ONLY the active section's data (decision C).
  let documents: DocumentItem[] | null = null;
  let report: ReportLoaderResult | null = null;

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
  }

  // Step 5 — render the hub.
  return new Response(
    JSON.stringify({ overview, ctx, section, documents, report }),
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
  const { overview, ctx, section, documents, report } = useLoaderData<typeof loader>() as {
    overview: StatusOverview;
    ctx: { tenant: string; inspectionId: string; token: string };
    section: HubSection;
    documents: DocumentItem[] | null;
    report: ReportLoaderResult | null;
  };
  const revalidator = useRevalidator();
  const { tenant, inspectionId, token } = ctx;

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
  } else if (NOT_YET_INLINED.includes(section)) {
    // Transitional: until ③–⑥ inline these, offer a link to the full page.
    sectionSlot = (
      <div className="rounded-xl border border-ih-border bg-ih-bg-card p-6 text-center">
        <p className="text-sm text-ih-fg-3">This section isn't available inline yet.</p>
        <a
          href={hubSectionHref(section, ctx)}
          className="mt-3 inline-block text-sm font-semibold text-ih-primary hover:underline"
        >
          Open the full page
        </a>
      </div>
    );
  }

  return (
    <InspectionHub
      overview={overview}
      ctx={ctx}
      activeSection={section}
      sectionSlot={sectionSlot}
    />
  );
}
