import { Outlet, NavLink, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/agent-layout";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { throwIfAgentTermsRequired } from "~/lib/agent-terms.server";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { AgentNoticeBell } from "~/components/agent/AgentNoticeBell";
import type { NoticeRowData } from "~/lib/notice-view";
import { m } from "~/paraglide/messages";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  // Agent-portal "session context" (agents are global users, so they have no
  // tenant auth-layout context). We surface just the agent's personal display
  // timezone here so every agent page can resolve dates the same way. null =
  // no personal override (dates then follow each inspecting company's tz).
  let timezone: string | null = null;
  const api = createApi(context, { token });

  // Fetched OUTSIDE the try below, and this is load-bearing rather than a style
  // choice. `throwIfAgentTermsRequired` signals by THROWING a redirect, and a
  // bare `catch` around it swallows that redirect as if it were a failed
  // timezone read — the agent would then sit on a data-less page forever
  // instead of being sent to the one screen that fixes it.
  let profileRes: Awaited<ReturnType<typeof api.agent.profile.$get>> | null = null;
  try {
    profileRes = await api.agent.profile.$get();
  } catch {
    // Leave it null: the caller treats absent as not-yet-accepted.
  }

  // The agent-terms gate refuses every authenticated agent request with 428
  // until the terms in force are accepted
  // (server/lib/middleware/agent-terms-gate.ts). This turns that refusal into
  // the screen that resolves it, carrying where they were trying to go.
  //
  // Read off a call this loader already makes rather than asking a status
  // endpoint of its own: every agent page runs this loader, so one extra round
  // trip here is one extra round trip everywhere. The gate is what actually
  // refuses — this is the redirect, not the enforcement — so the worst a miss
  // here can do is leave an agent on a page with no data.
  if (profileRes) await throwIfAgentTermsRequired(profileRes, request);

  try {
    if (profileRes?.ok) {
      const body = (await profileRes.json()) as { data?: { timezone?: string | null } };
      timezone = body.data?.timezone ?? null;
    }
  } catch {
    /* non-fatal: fall back to per-company / UTC resolution */
  }

  // C3 — the Notices bell rides this loader, which every agent page already
  // runs, so the unread badge is right before the panel is ever opened. Ambient
  // by nature: a failed read shows an empty bell rather than failing the page.
  let notices: { notices: NoticeRowData[]; unread: number } = { notices: [], unread: 0 };
  try {
    const res = await api.agentNotices.notices.$get({}, { headers: { "x-token-relay": "1" } });
    if (res.ok) {
      const body = (await res.json()) as { data?: { notices: NoticeRowData[]; unread: number } };
      if (body.data) notices = body.data;
    }
  } catch {
    /* non-fatal: an empty bell */
  }

  return { agentTimezone: timezone, notices };
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
  { to: "/agent-repair-items", label: () => m.agent_portal_repair_items() },
  { to: "/agent-inspectors", label: () => m.agent_portal_nav_inspectors() },
  { to: "/agent-settings/profile", label: () => m.agent_portal_settings_title() },
];

export default function AgentLayout({ loaderData }: Route.ComponentProps) {
  const { notices } = loaderData;
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
            <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 ml-2 hidden sm:inline">
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
                      ? "bg-ih-primary-tint text-ih-primary-text"
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
            {/* Notices — a bell in the header is always "sent to me"
                (design §3.15). Sits before the theme control so the two
                header affordances read left-to-right as inbox then settings. */}
            <span className="ml-2">
              <AgentNoticeBell notices={notices.notices} unread={notices.unread} />
            </span>
            <ThemeSegmentControl className="hidden md:flex ml-2" />
            <a
              href="/agent-logout"
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
