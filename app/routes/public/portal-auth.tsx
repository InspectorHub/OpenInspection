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
 *
 * A GET only SHOWS a "Continue" button; the link is spent by the POST that button sends. Mail
 * scanners and link previews fetch the emailed URL with a GET before the person does, and a link
 * that signs in (and is single-use) on GET would be gone by the time they click it.
 */
import { Form, redirect, useActionData, useLoaderData, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/portal-auth";
import { Button } from "@core/shared-ui";
import { createApi } from "~/lib/api-client.server";
import { isCrossSitePost } from "~/lib/same-origin-post.server";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
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

export async function loader({ params, request }: Route.LoaderArgs) {
  const tenant = params.tenant ?? "";
  // Nothing is redeemed here: this only decides whether there is a link to continue with.
  if (!new URL(request.url).searchParams.get("link")) {
    throw redirect(`/portal/${tenant}`);
  }
  return { tenant };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const tenant = params.tenant ?? "";
  // A form posted from another site is answered like an expired link, and the link is not spent (login CSRF).
  if (isCrossSitePost(request)) return { expired: true as const, rateLimited: false as const, tenant };
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
    // The route documents 200 and 401; the shared limiter's 429 is also possible and is shown as a limit, not as an expired link.
    if ((res.status as number) === 429) return { expired: false as const, rateLimited: true as const, tenant };
  } catch {
    // fall through to expired
  }
  return { expired: true as const, rateLimited: false as const, tenant };
}

export default function PortalAuth() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const { search } = useLocation();
  const latch = useSubmitLatch();
  const pending = navigation.state === "submitting";

  if (result?.expired) {
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

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">{m.portal_auth_continue_heading()}</h1>
      <p className="text-[14px] text-ih-fg-3 mb-6">{m.portal_auth_continue_body()}</p>
      {result?.rateLimited ? (
        <p role="alert" className="text-[14px] text-ih-bad-fg mb-4">{m.portal_auth_rate_limited()}</p>
      ) : null}
      {/* The action keeps the emailed query string (link, to) so the POST carries what the GET showed. */}
      <Form method="post" action={`/portal/${data.tenant}/auth${search}`} onSubmit={latch()}>
        <Button type="submit" pending={pending}>{m.portal_auth_continue_cta()}</Button>
      </Form>
    </div>
  );
}
