import { Outlet, NavLink, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/agent-layout";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { m } from "~/paraglide/messages";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  // Agent-portal "session context" (agents are global users, so they have no
  // tenant auth-layout context). We surface just the agent's personal display
  // timezone here so every agent page can resolve dates the same way. null =
  // no personal override (dates then follow each inspecting company's tz).
  let timezone: string | null = null;
  try {
    const api = createApi(context, { token });
    const res = await api.agent.profile.$get();
    if (res.ok) {
      const body = (await res.json()) as { data?: { timezone?: string | null } };
      timezone = body.data?.timezone ?? null;
    }
  } catch {
    /* non-fatal: fall back to per-company / UTC resolution */
  }
  return { agentTimezone: timezone };
}

/**
 * The signed-in agent's personal display-timezone override, or null when unset.
 * Reads the agent-layout loader (the agent-portal analogue of
 * useSessionContext). Consumers (e.g. the dashboard) use this as the top of the
 * resolution chain: agent override → each row's tenant tz → 'UTC'.
 */
export function useAgentTimeZoneOverride(): string | null {
  const data = useRouteLoaderData("routes/agent-layout") as
    | { agentTimezone: string | null }
    | undefined;
  return data?.agentTimezone ?? null;
}

// `label` is a thunk so the message resolves at render (inside paraglide's ALS
// scope), not at module load.
const NAV_ITEMS: { to: string; label: () => string }[] = [
  { to: "/agent-dashboard", label: () => m.agent_portal_nav_dashboard() },
  { to: "/agent-recommendations", label: () => m.agent_portal_repair_items() },
  { to: "/agent-inspectors", label: () => m.agent_portal_nav_inspectors() },
  { to: "/agent-settings/profile", label: () => m.agent_portal_settings_title() },
];

export default function AgentLayout() {
  return (
    <div className="min-h-screen bg-ih-bg-app">
      {/* Top bar */}
      <header className="border-b border-ih-border bg-ih-bg-card">
        <div className="max-w-[1080px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="w-7 h-7 shrink-0" width={28} height={28} />
            <span className="text-sm font-bold text-ih-fg-1">
              OpenInspection
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 ml-2 hidden sm:inline">
              {m.agent_portal_layout_badge()}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-ih-primary-tint text-ih-primary"
                      : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-fg-1"
                  }`
                }
              >
                {item.label()}
              </NavLink>
            ))}
            {/* Shared theme control — same 4-segment control as the tenant app,
                so the auto/light/dark/field preference (a same-origin cookie) is
                reachable and consistent here too. Hidden on the smallest widths
                where the top bar has no room; the field variant + cookie still
                apply. */}
            <ThemeSegmentControl className="hidden md:flex ml-2" />
            <a
              href="/logout"
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bad-bg hover:text-ih-bad-fg transition-colors ml-2"
            >
              {m.agent_portal_layout_logout()}
            </a>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1080px] mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
