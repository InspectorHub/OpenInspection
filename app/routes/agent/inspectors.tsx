import { useLoaderData } from "react-router";
import type { Route } from "./+types/inspectors";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_inspectors_meta_title() }];
}

interface Inspector {
  inspectorName: string | null;
  inspectorSlug: string | null;
  inspectorPhotoUrl: string | null;
  tenantName: string;
  tenantSlug: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.agent.inspectors.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { inspectors: (body.data ?? []) as Inspector[] };
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
      <PageHeader title={m.agent_portal_inspectors_title()} meta={m.agent_portal_inspectors_subtitle()} />

      {inspectors.length === 0 ? (
        <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
          <h3 className="text-lg font-bold text-ih-fg-1 mb-2">{m.agent_portal_inspectors_empty_title()}</h3>
          <p className="text-[13px] text-ih-fg-3 max-w-md mx-auto">
            {m.agent_portal_inspectors_empty_body()}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {inspectors.map((row, i) => (
            <article
              key={row.inspectorSlug || i}
              className="bg-ih-bg-card border border-ih-border rounded-xl p-5 flex flex-col gap-4 hover:-translate-y-0.5 hover:shadow-ih-popover transition-all"
            >
              <div className="flex items-center gap-3">
                {row.inspectorPhotoUrl ? (
                  <img
                    src={row.inspectorPhotoUrl}
                    alt={row.inspectorName || m.agent_portal_inspectors_photo_alt()}
                    className="w-14 h-14 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-14 h-14 rounded-full bg-ih-bg-muted flex items-center justify-center text-lg font-bold text-ih-fg-3 shrink-0">
                    {initials(row.inspectorName || row.tenantName)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ih-fg-1 truncate">
                    {row.inspectorName || row.tenantName}
                  </p>
                  <p className="text-[11px] font-semibold text-ih-fg-4 uppercase tracking-widest">
                    {row.tenantName}
                  </p>
                </div>
              </div>

              {row.inspectorSlug ? (
                <button
                  onClick={() => {
                    const url = `https://${row.tenantSlug}.inspectorhub.io/book/${row.inspectorSlug}`;
                    navigator.clipboard.writeText(url);
                  }}
                  className="w-full h-9 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors uppercase tracking-wide mt-auto"
                >
                  {m.agent_portal_inspectors_copy_link()}
                </button>
              ) : (
                <p className="text-[12px] text-ih-fg-4 mt-auto">
                  {m.agent_portal_inspectors_no_slug()}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
