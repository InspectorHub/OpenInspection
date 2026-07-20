/**
 * Unified client portal — landing route.
 *
 * Route: /portal/:tenant
 *   - Signed in (valid __Host-portal_session cookie) → "My Inspections" list.
 *   - Signed out → email entry form that requests a magic-link (no enumeration).
 *
 * BFF only: all `/api/portal` calls go through the typed client. The browser's
 * portal-session cookie is forwarded INTO the `me` call (the typed client's
 * fetch does not auto-forward it).
 */
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/portal";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import InspectionList, { type InspectionRow } from "~/components/portal/InspectionList";
import { signOut } from "~/components/portal/sign-out";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.portal_landing_meta_title() }];
}

type LoaderResult =
  | { authed: true; tenant: string; email: string; inspections: InspectionRow[]; brand: TenantBrand }
  | { authed: false; tenant: string; brand: TenantBrand };

export async function loader({
  params,
  request,
  context,
}: Route.LoaderArgs): Promise<LoaderResult> {
  const tenant = params.tenant ?? "";
  const api = createApi(context);
  const cookie = request.headers.get("cookie") ?? "";

  // Resolve the tenant brand for BOTH authed + signed-out states so the portal
  // shell reflects the company's logo / name / accent color. Degrades to
  // EMPTY_BRAND (platform default) on any failure.
  let brand: TenantBrand = EMPTY_BRAND;
  try {
    brand = await resolveTenantBrand(context, tenant);
  } catch {
    brand = EMPTY_BRAND;
  }

  try {
    const res = await api.portal[":tenant"].me.$get(
      { param: { tenant } },
      { headers: { Cookie: cookie } },
    );
    if (res.status === 200) {
      const body = (await res.json()) as {
        data?: { email: string; inspections: InspectionRow[] };
      };
      const data = body.data;
      if (data) {
        // Humanize each row's raw inspections.date in the tenant timezone,
        // server-side, so <InspectionList> renders a formatted string (never a
        // bare ISO). Preserve empty dates so the row's `r.date &&` guard holds.
        const inspections = data.inspections.map((row) => ({
          ...row,
          date: row.date
            ? formatInspectionDateTime(row.date, undefined, brand.defaultTimezone)
            : row.date,
        }));
        return { authed: true, tenant, email: data.email, inspections, brand };
      }
    }
  } catch {
    // fall through to unauthenticated
  }
  return { authed: false, tenant, brand };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const tenant = params.tenant ?? "";
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { sent: false as const };

  const api = createApi(context);
  try {
    await api.portal[":tenant"]["request-link"].$post({
      param: { tenant },
      json: { email },
    });
  } catch {
    // The API never enumerates; we mirror that and always report "sent".
  }
  return { sent: true as const };
}

/**
 * Brand line for the portal shell header: tenant logo (when set) + company name
 * as the eyebrow. Falls back to the generic "Client Portal" eyebrow when the
 * tenant has no name/logo, so the shell never looks broken.
 */
function BrandEyebrow({ brand }: { brand: TenantBrand }) {
  if (brand.logoUrl) {
    return (
      <div className="flex items-center gap-2 mb-2">
        <img src={brand.logoUrl} alt={brand.companyName ?? m.portal_brand_logo_alt()} className="h-8 w-auto" />
        {brand.companyName && (
          <span className="text-[13px] font-semibold text-ih-fg-2">{brand.companyName}</span>
        )}
      </div>
    );
  }
  return (
    <p className="text-[11px] font-bold tracking-widest uppercase text-ih-fg-4 mb-1">
      {brand.companyName ?? m.portal_brand_eyebrow_fallback()}
    </p>
  );
}

export default function PortalLanding() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (data.authed) {
    const tenant = data.tenant;
    return (
      <div style={brandTokens(data.brand.primaryColor)} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <BrandEyebrow brand={data.brand} />
            <h1 className="text-2xl font-bold text-ih-fg-1">{m.portal_landing_authed_heading()}</h1>
            <p className="text-[13px] text-ih-fg-3 mt-1">{m.portal_landing_signed_in_as({ email: data.email })}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut(tenant)}
            className="shrink-0 h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
          >
            {m.portal_signout()}
          </button>
        </div>
        <InspectionList
          rows={data.inspections}
          hrefFor={(id) => `/portal/${data.tenant}/i/${id}`}
        />
      </div>
    );
  }

  return (
    <div style={brandTokens(data.brand.primaryColor)} className="max-w-md mx-auto px-4 py-12">
      <div className="mb-6">
        <BrandEyebrow brand={data.brand} />
        <h1 className="text-2xl font-bold text-ih-fg-1">{m.portal_landing_signin_heading()}</h1>
        <p className="text-[14px] text-ih-fg-3 mt-1">
          {m.portal_landing_signin_subtitle()}
        </p>
      </div>

      {actionData?.sent ? (
        <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
          <p className="text-[14px] font-semibold text-ih-fg-1">
            {m.portal_landing_sent_title()}
          </p>
          <p className="text-[13px] text-ih-fg-3 mt-1">
            {m.portal_landing_sent_body()}
          </p>
          <p className="text-[13px] text-ih-fg-3 mt-3">
            {m.portal_landing_sent_recovery()}
          </p>
        </div>
      ) : (
        <Form method="post" className="space-y-3">
          <div>
            <label
              htmlFor="portal-email"
              className="block text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1"
            >
              {m.portal_landing_email_label()}
            </label>
            <input
              id="portal-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={m.portal_landing_email_placeholder()}
              className="w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[14px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:border-ih-primary"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-10 rounded-lg bg-ih-primary text-ih-fg-inverse text-[14px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
          >
            {submitting ? m.portal_landing_submit_pending() : m.portal_landing_submit()}
          </button>
        </Form>
      )}
    </div>
  );
}
