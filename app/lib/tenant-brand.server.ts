import type { AppLoadContext } from "react-router";
import { createApi } from "~/lib/api-client.server";
import { EMPTY_BRAND, type TenantBrand } from "~/lib/brand";

/**
 * A-10 — the one loader-side brand resolver every public surface uses.
 * Resolves the tenant brand by slug via `GET /api/public/brand/:tenant`;
 * any failure (unknown tenant, API down) degrades to the platform default
 * (null fields → design tokens untouched, APP_NAME site name).
 */
export async function resolveTenantBrand(
  context: AppLoadContext,
  tenantSlug: string | null | undefined,
): Promise<TenantBrand> {
  const fallbackName =
    ((context.cloudflare?.env as { APP_NAME?: string } | undefined)?.APP_NAME ?? null);
  if (!tenantSlug) return { ...EMPTY_BRAND, companyName: fallbackName };
  try {
    const api = createApi(context);
    const res = await api.publicReport.brand[":tenant"].$get({ param: { tenant: tenantSlug } });
    if (!res.ok) return { ...EMPTY_BRAND, companyName: fallbackName };
    const body = (await res.json()) as { data?: TenantBrand };
    const d = body.data;
    return {
      companyName: d?.companyName ?? fallbackName,
      primaryColor: d?.primaryColor ?? null,
      logoUrl: d?.logoUrl ?? null,
    };
  } catch {
    return { ...EMPTY_BRAND, companyName: fallbackName };
  }
}
