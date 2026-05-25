import { Outlet } from "react-router";
import type { Route } from "./+types/auth-layout";
import { requireToken } from "~/lib/session.server";
import { Sidebar } from "~/components/Sidebar";

export async function loader({ request }: Route.LoaderArgs) {
  await requireToken(request);
  return null;
}

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 w-full bg-[#f8fafc] dark:bg-slate-900 overflow-y-auto">
        <div className="pt-5 pb-9 px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
