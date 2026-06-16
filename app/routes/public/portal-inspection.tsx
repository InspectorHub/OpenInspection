/**
 * Unified client portal — per-inspection Hub.
 *
 * Route: /portal/:tenant/i/:inspectionId?token=&to=
 *   - ?token : a per-inspection access token (email CTA). If present we exchange
 *     it for a portal session cookie (forwarded to the browser) so a client
 *     arriving from email lands authenticated.
 *   - ?to    : optional HubSection — jump straight to that section's interim
 *     deep-link (carrying the token), instead of rendering the hub.
 *
 * Cookie forwarding (both directions):
 *   - exchange/redeem RESPONSE Set-Cookie → forwarded to the browser.
 *   - browser cookie (or the freshly-issued one) → forwarded INTO the overview
 *     call, since the typed client does not auto-forward the browser cookie.
 */
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal-inspection";
import { createApi } from "~/lib/api-client.server";
import InspectionHub, {
  hubSectionHref,
  type HubSection,
} from "~/components/portal/InspectionHub";
import type { StatusOverview } from "~/components/portal/InspectionStatusCards";

export function meta() {
  return [{ title: "Inspection - OpenInspection" }];
}

// HubSections that have an interim deep-link target (everything except the hub
// itself, which IS this page). Used to validate the ?to query.
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

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const tenant = params.tenant ?? "";
  const inspectionId = params.inspectionId ?? "";
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const to = url.searchParams.get("to");

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
          cookieToForward = minted;
          // The Set-Cookie value's first `name=value;` pair is a valid Cookie
          // header value for the same-request overview call.
          cookieForApi = minted;
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
    const body = (await res.json()) as { data?: StatusOverview };
    if (!body.data) throw new Response("Not found", { status: 404 });
    overview = body.data;
  } catch (err) {
    if (err instanceof Response) throw err;
    throw new Response("Not found", { status: 404 });
  }

  const ctx = { tenant, inspectionId, token: token ?? "" };

  // Step 3 — if ?to names a real deep-link section, jump straight there
  // (carrying the token), forwarding any freshly-issued session cookie.
  if (isDeepLinkSection(to)) {
    throw redirect(hubSectionHref(to, ctx), {
      headers: cookieToForward ? { "Set-Cookie": cookieToForward } : undefined,
    });
  }

  // Step 4 — render the hub.
  return new Response(
    JSON.stringify({ overview, ctx }),
    {
      headers: {
        "Content-Type": "application/json",
        ...(cookieToForward ? { "Set-Cookie": cookieToForward } : {}),
      },
    },
  );
}

export default function PortalInspection() {
  const { overview, ctx } = useLoaderData<typeof loader>() as {
    overview: StatusOverview;
    ctx: { tenant: string; inspectionId: string; token: string };
  };
  return <InspectionHub overview={overview} ctx={ctx} activeSection="overview" />;
}
