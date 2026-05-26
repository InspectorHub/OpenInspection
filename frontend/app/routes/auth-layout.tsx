import { Outlet } from "react-router";
import type { Route } from "./+types/auth-layout";
import { requireToken } from "~/lib/session.server";
import { Sidebar, MobileHeader } from "~/components/Sidebar";

export async function loader({ request }: Route.LoaderArgs) {
  await requireToken(request);
  return null;
}

export default function AuthLayout() {
  return (
    <>
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
