import { useLoaderData } from "react-router";
import type { Route } from "./+types/tags";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Tags - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/tags", { token });
    const data = res.ok ? await res.json() : {};
    return { tags: (data as any)?.data || [] };
  } catch {
    return { tags: [] };
  }
}

export default function TagsPage() {
  const { tags } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library · Tags
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Tags</h1>
          <p className="text-[13px] text-slate-500 mt-1">{tags.length} tags</p>
        </div>
        <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2">
          + Add tag
        </button>
      </div>

      {tags.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">No tags yet</p>
          <p className="text-sm text-slate-500 mt-1">Click "+ Add tag" above to organize your library with tags.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Color</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Used</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {tags.map((tag: any) => (
                <tr key={tag.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                      {tag.color && (
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      )}
                      {tag.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-500">{tag.color || "--"}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-500">{tag.count ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-[13px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
