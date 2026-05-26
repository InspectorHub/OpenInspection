import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/auth-layout";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { Sidebar, MobileHeader } from "~/components/Sidebar";
import type { SessionContext } from "~/hooks/useSessionContext";

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  let context: SessionContext | null = null;
  try {
    const res = await apiFetch("/api/session/context", { token });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      context = body.data as SessionContext;
    }
  } catch {
    // Graceful fallback — layout renders with defaults
  }
  return { context };
}

export default function AuthLayout() {
  const { context } = useLoaderData<typeof loader>();

  return (
    <>
      {/* F5 — Google Analytics (auth-scoped, only when gaMeasurementId is set) */}
      {context?.branding?.gaMeasurementId && (
        <>
          <script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${context.branding.gaMeasurementId}`}
          />
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${context.branding.gaMeasurementId}');
              `,
            }}
          />
        </>
      )}

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
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
