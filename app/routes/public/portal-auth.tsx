/**
 * Unified client portal — magic-link redemption.
 *
 * Route: /portal/:tenant/auth?link=<magic-link token>
 *   - Valid link → API sets __Host-portal_session; we forward that Set-Cookie to
 *     the browser and redirect to /portal/:tenant (now authenticated).
 *   - Missing link → redirect to /portal/:tenant.
 *   - Expired/invalid link → "expired" state with a path back to request a new one.
 */
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal-auth";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Signing in - OpenInspection" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const tenant = params.tenant ?? "";
  const url = new URL(request.url);
  const link = url.searchParams.get("link");
  if (!link) {
    throw redirect(`/portal/${tenant}`);
  }

  const api = createApi(context);
  try {
    const res = await api.portal[":tenant"].redeem.$get({
      param: { tenant },
      query: { link },
    });
    if (res.status === 200) {
      // Forward the session cookie minted by the API to the browser, then land
      // the user on their My Inspections page (now authenticated).
      const cookie = res.headers.get("set-cookie");
      return redirect(`/portal/${tenant}`, {
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
      <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">This link has expired</h1>
      <p className="text-[14px] text-ih-fg-3 mb-6">
        Sign-in links expire after 15 minutes. Request a new one to continue.
      </p>
      <a
        href={`/portal/${data.tenant}`}
        className="inline-flex items-center h-10 px-5 rounded-lg bg-ih-primary text-ih-fg-inverse text-[14px] font-bold hover:bg-ih-primary-600 transition-colors"
      >
        Request a new link
      </a>
    </div>
  );
}
