import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";

export function meta() {
  return [{ title: "Dashboard - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireToken(request);
  return { message: "Authenticated! Dashboard coming in Task 4." };
}

export default function Dashboard() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-slate-500 mt-2">
          You are logged in. Full dashboard coming in Task 4.
        </p>
        <a
          href="/logout"
          className="mt-4 inline-block text-red-600 hover:underline text-sm"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
