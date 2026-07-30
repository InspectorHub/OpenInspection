import { createApi } from "~/lib/api-client.server";
import { EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { getBaseUrlFromRequest, rebaseHostedLegalUrl } from "~/lib/legal-base-url";
import { getCloudflareEnv, type LoadContext } from "~/lib/load-context";

/**
 * A-10 — the one loader-side brand resolver every public surface uses.
 * Resolves the tenant brand by slug via `GET /api/public/brand/:tenant`;
 * any failure (unknown tenant, API down) degrades to the platform default
 * (null fields → design tokens untouched, APP_NAME site name).
 *
 * Pass `request` so hosted Privacy/Terms URLs are rebased onto the
 * browser-facing origin (APP_BASE_URL / Host quirks on in-process API).
 */
export async function resolveTenantBrand(
  context: LoadContext,
  tenantSlug: string | null | undefined,
  request?: Request,
): Promise<TenantBrand> {
  const fallbackName = getCloudflareEnv(context).APP_NAME ?? null;
  if (!tenantSlug) return { ...EMPTY_BRAND, companyName: fallbackName };
  try {
    const api = createApi(context);
    const res = await api.publicReport.brand[":tenant"].$get({ param: { tenant: tenantSlug } });
    if (!res.ok) return { ...EMPTY_BRAND, companyName: fallbackName };
    const body = (await res.json()) as { data?: TenantBrand };
    const d = body.data;
    let privacyUrl = d?.privacyUrl ?? null;
    let termsUrl = d?.termsUrl ?? null;
    if (request) {
      const origin = getBaseUrlFromRequest(request);
      privacyUrl = rebaseHostedLegalUrl(privacyUrl, origin);
      termsUrl = rebaseHostedLegalUrl(termsUrl, origin);
    }
    return {
      companyName: d?.companyName ?? fallbackName,
      primaryColor: d?.primaryColor ?? null,
      logoUrl: d?.logoUrl ?? null,
      defaultTimezone: d?.defaultTimezone ?? "UTC",
      supportEmail: d?.supportEmail ?? null,
      companyPhone: d?.companyPhone ?? null,
      privacyUrl,
      termsUrl,
    };
  } catch {
    return { ...EMPTY_BRAND, companyName: fallbackName };
  }
}
