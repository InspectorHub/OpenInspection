/**
 * Per-section loader factory for the unified client-portal Hub.
 *
 * Extracted verbatim from app/routes/public/portal-inspection.tsx (behavior-
 * preserving): the route's loader keeps the SAME ?section= branching and returns
 * the SAME shapes — it just delegates the per-section fetch to the functions here.
 *
 * Each loader mirrors the corresponding standalone route loader's wire→view
 * mapping, authenticated with the portal per-inspection token (ctx.token), the
 * recipient's email-matched signer token, or the forwarded portal-session cookie,
 * exactly as documented per-section below.
 */
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";
import { formatDate } from "~/lib/format";
import { EMPTY_BRAND } from "~/lib/brand";
import type { HubSection } from "~/components/portal/ClientPortalHub";
import type { ProgressSection } from "~/components/portal/sections/ProgressView";
import type {
  LoaderResult as RepairLoaderResult,
  Defect as RepairDefect,
  RepairRequest,
} from "~/components/portal/sections/RepairBuilderSection";
import type { AgreementData } from "~/components/portal/sections/AgreementSection";
import type { InvoiceData } from "~/components/portal/sections/PaymentSection";
import type { TenantBrand } from "~/lib/brand";
// Type-only — erased at build, so no server module reaches the client bundle.
import type { z } from "@hono/zod-openapi";
import type { PublicInvoiceBodySchema } from "../../server/lib/validations/invoice.schema";
import type { LoadContext } from "~/lib/load-context";

/* ------------------------------------------------------------------ */
/* Section validation */
/* ------------------------------------------------------------------ */

/**
 * Every Hub section, as data.
 *
 * A `Record<HubSection, true>` rather than an array, so the COMPILER is what
 * keeps this in sync with the union: adding a member to `HubSection` without
 * adding it here is a type error, not a section that silently falls back to
 * the overview. That is exactly how `notifications` shipped unreachable — the
 * type had it, this list did not, and nothing said so (CLAUDE.md: make a
 * "must stay in sync" coupling executable, not a comment).
 */
const HUB_SECTION_SET: Record<HubSection, true> = {
  overview: true,
  report: true,
  agreement: true,
  payment: true,
  progress: true,
  messages: true,
  repair: true,
  documents: true,
  notifications: true,
};

const HUB_SECTIONS = Object.keys(HUB_SECTION_SET) as HubSection[];

export function parseSection(v: string | null): HubSection {
  return v !== null && (HUB_SECTIONS as string[]).includes(v) ? (v as HubSection) : "overview";
}

// Sections the ?to= email-CTA may jump to (every real Hub section except the
// default "overview", which needs no redirect).
export function isJumpSection(v: string | null): v is HubSection {
  return v !== null && v !== "overview" && (HUB_SECTIONS as string[]).includes(v);
}

/* Report section — lives in its own module (it is ~120 lines of wire→view
 * field defaulting); re-exported so importers keep one entry point. */
export { loadReportSection } from "~/lib/report-section-loader";

/* ------------------------------------------------------------------ */
/* Progress section data — served via the portal-session-authed progress
 * endpoint (membership-checked). The portal client is already authenticated by
 * the __Host-portal_session cookie, which is forwarded into the API call
 * exactly like the overview call. */
/* ------------------------------------------------------------------ */

export interface ProgressLoaderResult {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: ProgressSection[];
  error: string | null;
}

export async function loadProgressSection(
  context: LoadContext,
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
      error: res.ok && has ? null : m.helper_section_inspection_not_found(),
    };
  } catch {
    return {
      address: "",
      date: null,
      inspectorName: "",
      status: "",
      sections: [],
      error: m.helper_section_service_unavailable(),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Repair section data — mirrors the standalone repair-builder loader mapping,
 * authenticated with the portal per-inspection token (ctx.token). */
/* ------------------------------------------------------------------ */

export async function loadRepairSection(
  context: LoadContext,
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
      data?: { defects: RepairDefect[]; mine: RepairRequest[]; quickPhrases: string[] | null };
    };
    const data = body.data;
    if (!data) return { kind: "error" };

    return {
      kind: "ok",
      defects: data.defects,
      mine: data.mine,
      tenant,
      id: inspectionId,
      // #275 — must mirror the standalone loader below EXACTLY. Drop it here and
      // the quick buttons work on /repair-builder/… and silently vanish on the Hub.
      quickPhrases: data.quickPhrases ?? null,
      token: token || null,
    };
  } catch {
    return { kind: "error" };
  }
}

/* ------------------------------------------------------------------ */
/* Payment section data — mirrors the standalone invoice loader mapping.
 * IA-34: the invoice endpoint is gated by resolveClientActor, so this forwards
 * the Hub's per-inspection portal token (ctx.token — the server-issued
 * persistent token, or the email-CTA ?token=). The token is also handed to
 * <PaymentSection> so the browser's pay-intent call authenticates the same way.
 * Agent-kind tokens never reach here: the Hub loader forces section="report"
 * for them, and the endpoint would refuse an agent grant anyway. */
/* ------------------------------------------------------------------ */

export interface InvoiceLoaderResult {
  invoice: InvoiceData | null;
  brand: TenantBrand;
  error: string | null;
}

/**
 * Wire shape of GET /api/public/inspections/:id/invoice, DERIVED from the route's
 * own schema — one declaration, shared by both callers (the Hub's payment section
 * below and the standalone `/invoice/:id` page).
 *
 * It used to be two hand-written copies, and they had already drifted:
 * `tenantSlug` was added to the server schema and to the standalone page's copy
 * but not to this one. Nothing catches that — a hand-written mirror of a wire
 * payload sits on a boundary no type-checker spans. Now it does.
 */
export type RawInvoice = z.infer<typeof PublicInvoiceBodySchema>;

export async function loadInvoiceSection(
  context: LoadContext,
  inspectionId: string,
  token: string,
  cookie: string,
): Promise<InvoiceLoaderResult> {
  try {
    const api = createApi(context);
    // BOTH credentials the gate accepts. The per-inspection token is normally
    // present, but the overview endpoint issues it best-effort, so a
    // magic-link session that momentarily has no token still authenticates via
    // the forwarded portal-session cookie (the typed client does not forward
    // the browser cookie on its own — mirrors the documents section).
    const res = await api.publicReport.inspections[":id"].invoice.$get(
      { param: { id: inspectionId }, query: token ? { token } : {} },
      { headers: { Cookie: cookie } },
    );
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? null) as RawInvoice | null;
    const invoice: InvoiceData | null = d
      ? {
          number: `INV-${d.id.slice(0, 8).toUpperCase()}`,
          // Issued/Due are calendar dates (YYYY-MM-DD) — format for display via
          // the shared formatter (locale only; date-only anchors to UTC). Keep
          // empty/null so the "—" / "Due on receipt" fallbacks still apply.
          date: d.createdAt ? formatDate(d.createdAt.slice(0, 10), { locale: "en-US", timeZone: "UTC" }) : "",
          dueDate: d.dueDate ? formatDate(d.dueDate, { locale: "en-US", timeZone: "UTC" }) : null,
          status: (d.status as InvoiceData["status"]) ?? "draft",
          clientName: d.clientName ?? "",
          inspectorName: "",
          lineItems: (d.lineItems ?? []).map((li) => ({ description: li.description, amount: li.amountCents / 100 })),
          total: d.amountCents / 100,
          currency: d.currency,
        }
      : null;
    return {
      invoice,
      brand: d?.brand ?? EMPTY_BRAND,
      error: res.ok ? null : m.helper_section_invoice_not_found(),
    };
  } catch {
    return { invoice: null, brand: EMPTY_BRAND, error: m.helper_section_service_unavailable() };
  }
}

/* ------------------------------------------------------------------ */
/* Agreement section data — mirrors the standalone agreement-sign loader.
 * Fetched with the recipient's OWN email-matched signer token (NOT the
 * per-inspection access token). The overview endpoint resolves that token
 * server-side (email-matched, never cross-signer). A null signerToken means the
 * recipient is not a signer → no agreement to render. */
/* ------------------------------------------------------------------ */

export interface AgreementLoaderResult {
  agreement: AgreementData | null;
  error: string | null;
}

export async function loadAgreementSection(
  context: LoadContext,
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
    return { agreement: d, error: res.ok ? null : m.helper_section_agreement_not_found() };
  } catch {
    return { agreement: null, error: m.helper_section_service_unavailable() };
  }
}
