import { Outlet, NavLink } from "react-router";
import type { Route } from "./+types/agent-layout";
import { requireToken } from "~/lib/session.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireToken(context, request);
  return null;
}

const NAV_ITEMS = [
  { to: "/agent-dashboard", label: "Dashboard" },
  { to: "/agent-recommendations", label: "Repair Items" },
  { to: "/agent-inspectors", label: "Inspectors" },
  { to: "/agent-settings/profile", label: "Settings" },
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
              Agent Portal
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
                {item.label}
              </NavLink>
            ))}
            <a
              href="/logout"
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bad-bg hover:text-ih-bad-fg transition-colors ml-2"
            >
              Log out
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
