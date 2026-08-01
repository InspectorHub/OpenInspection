/**
 * The client's notification settings, as a page of its own.
 *
 * Route: /portal/:tenant/notifications
 *   - Signed in (valid __Host-portal_session cookie) → the same settings
 *     surface the Hub bell opens.
 *   - Signed out → an email entry form that requests a one-time link back to
 *     THIS page, and which never says whether the address is known.
 *
 * WHY A SECOND ENTRANCE TO A SCREEN THAT ALREADY EXISTS (spec §4.1). The Hub's
 * copy of this surface hangs off an inspection: it is reached from the bell,
 * and the URL names an inspection the reader happened to be standing on. The
 * privacy policy and the terms have to link somewhere too, and they are read by
 * people who are not standing anywhere — often not signed in, and with no
 * inspection to name. A link into the Hub would be a link into an inspection
 * they may not have open, which is why this route takes none.
 *
 * NO ENUMERATION. The signed-out form's response is identical whether or not
 * the address is known — the same rule `portal/request-link` already follows,
 * and here it matters more, because the address is being typed by someone
 * following a link out of a public legal document. The API is the part that
 * makes this true (its response is payload- AND timing-identical); this page
 * simply never asks a question whose answer could differ, and always renders
 * the same "check your email" panel.
 *
 * BFF only: every `/api/portal` call goes through the typed client, with the
 * browser's portal-session cookie forwarded in explicitly (the typed client's
 * fetch does not carry it).
 */
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/portal-notifications";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { PortalNotificationSection } from "~/components/portal/hub/PortalNotificationSection";
import { PublicLegalFooter } from "~/components/PublicLegalFooter";
import { signOut } from "~/components/portal/sign-out";
import {
  loadNotificationsSection,
  savePortalNotificationChoice,
  bulkPortalNotificationChoice,
  grantPortalSmsConsent,
  type NotificationsLoaderResult,
} from "~/lib/portal-notification-preferences";
import { Input, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.portal_notif_page_meta_title() }];
}

type LoaderResult =
  | { authed: true; tenant: string; email: string; brand: TenantBrand; notifications: NotificationsLoaderResult }
  | { authed: false; tenant: string; brand: TenantBrand };

export async function loader({ params, request, context }: Route.LoaderArgs): Promise<LoaderResult> {
  const tenant = params.tenant ?? "";
  const api = createApi(context);
  const cookie = request.headers.get("cookie") ?? "";

  let brand: TenantBrand = EMPTY_BRAND;
  try {
    brand = await resolveTenantBrand(context, tenant, request);
  } catch {
    brand = EMPTY_BRAND;
  }

  // `me` decides authed-vs-not, exactly as the portal landing does, so the two
  // entrances agree about what "signed in" means. The preferences read is a
  // separate call whose own failures surface as an in-page error rather than as
  // a sign-in form — a reader with a live session must never be told to sign in
  // because a query failed.
  try {
    const res = await api.portal[":tenant"].me.$get(
      { param: { tenant } },
      { headers: { Cookie: cookie } },
    );
    if (res.status === 200) {
      const body = (await res.json()) as { data?: { email: string } };
      const email = body.data?.email;
      if (email) {
        const notifications = await loadNotificationsSection(context, tenant, cookie);
        return { authed: true, tenant, email, brand, notifications };
      }
    }
  } catch {
    // fall through to the signed-out form
  }
  return { authed: false, tenant, brand };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const tenant = params.tenant ?? "";
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const cookie = request.headers.get("cookie") ?? "";

  // The same three intents the Hub's action listens for, handled by the same
  // three helpers. One surface, one contract — a divergence here would be a
  // switch that works on one entrance and not the other.
  if (intent === "notification-sms-grant") {
    return { ...(await grantPortalSmsConsent(context, tenant, request, formData)), intent };
  }
  if (intent === "notification-bulk") {
    return { ...(await bulkPortalNotificationChoice(context, tenant, cookie, formData)), intent };
  }
  if (intent === "notification-preference") {
    return { ...(await savePortalNotificationChoice(context, tenant, cookie, formData)), intent };
  }

  // Signed-out: request a one-time link that comes back HERE.
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { sent: false as const };
  try {
    await createApi(context).portal[":tenant"]["request-link"].$post({
      param: { tenant },
      json: { email, destination: "notifications" },
    });
  } catch {
    // The API never enumerates; we mirror that and always report "sent".
  }
  return { sent: true as const };
}

export default function PortalNotificationsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (data.authed) {
    return (
      <div style={brandTokens(data.brand.primaryColor)} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-widest uppercase text-ih-fg-4 mb-1">
              {data.brand.companyName ?? m.portal_brand_eyebrow_fallback()}
            </p>
            <p className="text-[13px] text-ih-fg-3">
              {m.portal_landing_signed_in_as({ email: data.email })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut(data.tenant)}
            className="shrink-0 h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
          >
            {m.portal_signout()}
          </button>
        </div>

        <PortalNotificationSection
          alwaysSent={data.notifications.alwaysSent}
          youChoose={data.notifications.youChoose}
          smsConsent={data.notifications.smsConsent}
          error={data.notifications.error}
        />

        <a
          href={`/portal/${data.tenant}`}
          className="inline-flex items-center h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
        >
          {m.portal_notif_back_to_portal()}
        </a>

        <PublicLegalFooter privacyUrl={data.brand.privacyUrl} termsUrl={data.brand.termsUrl} />
      </div>
    );
  }

  return (
    <div style={brandTokens(data.brand.primaryColor)} className="max-w-md mx-auto px-4 py-12">
      <div className="mb-6">
        <p className="text-[11px] font-bold tracking-widest uppercase text-ih-fg-4 mb-1">
          {data.brand.companyName ?? m.portal_brand_eyebrow_fallback()}
        </p>
        <h1 className="text-2xl font-bold text-ih-fg-1">{m.portal_notif_signin_heading()}</h1>
        <p className="text-[14px] text-ih-fg-3 mt-1">{m.portal_notif_signin_subtitle()}</p>
      </div>

      {actionData && "sent" in actionData && actionData.sent ? (
        <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
          <p className="text-[14px] font-semibold text-ih-fg-1">{m.portal_landing_sent_title()}</p>
          {/* Deliberately conditional-voice: "if an account matches". Saying
              "we sent you a link" would confirm the address is known, which is
              the enumeration this whole flow exists to avoid. */}
          <p className="text-[13px] text-ih-fg-3 mt-1">{m.portal_landing_sent_body()}</p>
          <p className="text-[13px] text-ih-fg-3 mt-3">{m.portal_landing_sent_recovery()}</p>
        </div>
      ) : (
        <Form method="post" className="space-y-3">
          <Input
            id="portal-notifications-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            label={m.portal_landing_email_label()}
            placeholder={m.portal_landing_email_placeholder()}
          />
          <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
            {/* Not "sign-in link": the heading above promised notification
                settings, and a button naming a different destination is the
                one line on this page a reader would have to reconcile. */}
            {submitting ? m.portal_landing_submit_pending() : m.portal_notif_submit()}
          </Button>
        </Form>
      )}

      <PublicLegalFooter privacyUrl={data.brand.privacyUrl} termsUrl={data.brand.termsUrl} />
    </div>
  );
}
