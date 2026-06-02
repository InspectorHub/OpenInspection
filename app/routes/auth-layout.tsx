import { Outlet, useLoaderData, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/auth-layout";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { Sidebar, MobileHeader } from "~/components/Sidebar";
import { PageLoadingSkeleton } from "~/components/PageLoadingSkeleton";
import type { SessionContext } from "~/hooks/useSessionContext";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  let sessionContext: SessionContext | null = null;
  try {
    const api = createApi(context, { token });
    const res = await api.sessionContext.context.$get();
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      sessionContext = body.data as SessionContext;
    }
  } catch {
    // Graceful fallback — layout renders with defaults
  }
  return { context: sessionContext };
}

export default function AuthLayout() {
  const { context } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();

  // Show a content-pane skeleton only during a *real* page navigation:
  // - navigation.state === "loading" (loader in flight, not a form submission)
  // - navigation.location is set (guards against revalidation, which has no location)
  // - the target path differs from the current path (ignore search-param-only
  //   refetches / replace-in-place updates so we don't flash a skeleton over
  //   the page the user is already on)
  const isNavigatingToNewPage =
    navigation.state === "loading" &&
    navigation.location != null &&
    navigation.location.pathname !== location.pathname;

  return (
    <>
      {/* F4 — Suspension banner */}
      {context?.branding?.tenantStatus === "suspended" && (
        <div className="bg-ih-watch-bg border-b border-ih-watch px-4 py-3 flex items-center justify-center gap-3 z-50">
          <p className="text-sm font-semibold text-ih-watch-fg">
            This workspace is suspended. You can view existing content but
            cannot create or edit inspections.
          </p>
        </div>
      )}

      <MobileHeader />
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 w-full bg-ih-bg-app overflow-y-auto">
          <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9">
            {isNavigatingToNewPage ? <PageLoadingSkeleton /> : <Outlet />}
          </div>
        </main>
      </div>
    </>
  );
}
