/**
 * Unified client portal — magic-link redemption.
 *
 * Route: /portal/:tenant/auth?link=<magic-link token>
 *   - Valid link, client/co_client email → API sets __Host-portal_session; we
 *     forward that Set-Cookie to the browser and redirect to /portal/:tenant
 *     (now authenticated).
 *   - Valid link, GLOBAL AGENT email (find-my-report analogue of the agent
 *     exchange branch — server/api/portal.ts redeemRoute) → API instead sets
 *     __Host-inspector_token and returns `{ email, agent: true }`, NO
 *     __Host-portal_session. We forward that Set-Cookie and redirect to
 *     /agent-dashboard, never the client hub.
 *   - Missing link → redirect to /portal/:tenant.
 *   - Expired/invalid link → "expired" state with a path back to request a new one.
 */
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal-auth";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.portal_auth_meta_title() }];
}

/**
 * Where a redeemed link lands.
 *
 * A pure function, and separate from the loader, because one of its four
 * answers is a SECURITY property rather than a routing preference: an
 * agent-resolved redeem holds `__Host-inspector_token` and no
 * `__Host-portal_session`, so it must never be handed a `/portal/` path — the
 * client hub would answer it as an unauthenticated stranger at best, and the
 * intent of the agent branch is that its report token can never unlock the
 * client hub at all (server/api/portal.ts redeemRoute).
 *
 * `wantsNotifications` is a boolean by the time it arrives here, not a string
 * and never a path: the caller matches `?to=` against one literal, so there is
 * nothing for a crafted link to point at.
 */
export function redeemDestination(
  { agent, wantsNotifications, tenant }:
  { agent: boolean; wantsNotifications: boolean; tenant: string },
): string {
  if (agent) return wantsNotifications ? "/agent-settings/profile" : "/agent-dashboard";
  return wantsNotifications ? `/portal/${tenant}/notifications` : `/portal/${tenant}`;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const tenant = params.tenant ?? "";
  const url = new URL(request.url);
  const link = url.searchParams.get("link");
  if (!link) {
    throw redirect(`/portal/${tenant}`);
  }
  // `to` is matched against a fixed set and never used as a path. It arrives in
  // a link inside an email, so treating it as one would be an open redirect the
  // attacker gets to deliver. Anything unrecognised falls to the default.
  const wantsNotifications = url.searchParams.get("to") === "notifications";

  const api = createApi(context);
  try {
    const res = await api.portal[":tenant"].redeem.$get({
      param: { tenant },
      query: { link },
    });
    if (res.status === 200) {
      const cookie = res.headers.get("set-cookie");
      const body = (await res.json()) as { data?: { email: string; agent?: boolean } };
      const destination = redeemDestination({
        agent: body.data?.agent === true,
        wantsNotifications,
        tenant,
      });
      return redirect(destination, {
        headers: cookie ? { "Set-Cookie": cookie } : undefined,
      });
    }
  } catch {
    // fall through to expired
  }
  return { expired: true as const, tenant };
}

export default function PortalAuth() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">{m.portal_auth_expired_heading()}</h1>
      <p className="text-[14px] text-ih-fg-3 mb-6">
        {m.portal_auth_expired_body()}
      </p>
      <a
        href={`/portal/${data.tenant}`}
        className="inline-flex items-center h-10 px-5 rounded-lg bg-ih-primary text-ih-fg-inverse text-[14px] font-bold hover:bg-ih-primary-600 transition-colors"
      >
        {m.portal_auth_expired_cta()}
      </a>
    </div>
  );
}
