import { useLoaderData } from "react-router";
import type { Route } from "./+types/inspectors";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Your Inspectors - OpenInspection" }];
}

interface Inspector {
  inspectorName: string | null;
  inspectorSlug: string | null;
  inspectorPhotoUrl: string | null;
  tenantName: string;
  tenantSubdomain: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/inspectors", { token });
    const data = res.ok ? await res.json() : {};
    return { inspectors: ((data as any)?.data || []) as Inspector[] };
  } catch {
    return { inspectors: [] as Inspector[] };
  }
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export default function AgentInspectorsPage() {
  const { inspectors } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-white">Your Inspectors</h1>
        <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1">
          Every team you partner with. Copy a booking link to share with clients.
        </p>
      </div>

      {inspectors.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No inspectors linked yet</h3>
          <p className="text-[13px] text-slate-500 max-w-md mx-auto">
            Inspectors who invite you, or whose contact list already has your email,
            will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {inspectors.map((row, i) => (
            <article
              key={row.inspectorSlug || i}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex flex-col gap-4 hover:-translate-y-0.5 hover:shadow-lg transition-all"
            >
              <div className="flex items-center gap-3">
                {row.inspectorPhotoUrl ? (
                  <img
                    src={row.inspectorPhotoUrl}
                    alt={row.inspectorName || "Inspector"}
                    className="w-14 h-14 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg font-bold text-slate-500 dark:text-slate-400 shrink-0">
                    {initials(row.inspectorName || row.tenantName)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100 truncate">
                    {row.inspectorName || row.tenantName}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                    {row.tenantName}
                  </p>
                </div>
              </div>

              {row.inspectorSlug ? (
                <button
                  onClick={() => {
                    const url = `https://${row.tenantSubdomain}.inspectorhub.io/book/${row.inspectorSlug}`;
                    navigator.clipboard.writeText(url);
                  }}
                  className="w-full h-9 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors uppercase tracking-wide mt-auto"
                >
                  Copy Booking Link
                </button>
              ) : (
                <p className="text-[12px] text-slate-400 mt-auto">
                  This inspector has not published a booking slug yet.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
