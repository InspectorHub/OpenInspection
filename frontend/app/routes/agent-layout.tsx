import { Outlet, NavLink } from "react-router";
import type { Route } from "./+types/agent-layout";
import { requireToken } from "~/lib/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireToken(request);
  return null;
}

const NAV_ITEMS = [
  { to: "/agent-dashboard", label: "Dashboard" },
  { to: "/agent-recommendations", label: "Recommendations" },
  { to: "/agent-inspectors", label: "Inspectors" },
  { to: "/agent-settings/profile", label: "Settings" },
];

export default function AgentLayout() {
  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-900">
      {/* Top bar */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="max-w-[1080px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="w-7 h-7 shrink-0" />
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              OpenInspection
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 ml-2 hidden sm:inline">
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
                      ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <a
              href="/logout"
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors ml-2"
            >
              Sign out
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
