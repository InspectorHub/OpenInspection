import { useLoaderData } from "react-router";
import type { Route } from "./+types/recommendations";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Repair Items - OpenInspection" }];
}

interface Recommendation {
  inspectionId: string;
  propertyAddress: string | null;
  sectionTitle: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
}

interface Groups {
  safety: Recommendation[];
  recommendation: Recommendation[];
  maintenance: Recommendation[];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.agent["my-recommendations"].$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown>;
    return {
      groups: {
        safety: Array.isArray(d?.safety) ? d.safety : [],
        recommendation: Array.isArray(d?.recommendation) ? d.recommendation : [],
        maintenance: Array.isArray(d?.maintenance) ? d.maintenance : [],
      } as Groups,
    };
  } catch {
    return { groups: { safety: [], recommendation: [], maintenance: [] } as Groups };
  }
}

const GROUP_META = [
  { key: "safety" as const, label: "Safety", color: "text-ih-bad-fg" },
  { key: "recommendation" as const, label: "Recommendation", color: "text-ih-watch-fg" },
  { key: "maintenance" as const, label: "Maintenance", color: "text-ih-info-fg" },
];

export default function AgentRecommendationsPage() {
  const { groups } = useLoaderData<typeof loader>();
  const total = groups.safety.length + groups.recommendation.length + groups.maintenance.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ih-fg-1">Repair Items</h1>
          <p className="text-[14px] text-ih-fg-3 mt-1">
            Every defect flagged in delivered inspection reports, grouped by category.
            {total > 0 && ` ${total} total items.`}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors shrink-0"
        >
          Print as PDF
        </button>
      </div>

      {GROUP_META.map(({ key, label, color }) => {
        const items = groups[key];
        return (
          <section key={key} className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-ih-border">
              <h2 className={`text-lg font-bold ${color}`}>{label}</h2>
              <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="text-[13px] text-ih-fg-4 py-2">
                No {label.toLowerCase()} items in your referred reports.
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((r, i) => (
                  <div key={`${r.inspectionId}-${r.defectTitle}-${i}`} className="p-4 border border-ih-border rounded-md bg-ih-bg-app/30">
                    <p className="text-[11px] font-mono text-ih-fg-4 mb-1">
                      {r.propertyAddress || "No address"} &middot; {r.sectionTitle}
                    </p>
                    <p className="text-[14px] font-semibold text-ih-fg-1">{r.defectTitle}</p>
                    {r.location && (
                      <p className="text-[13px] text-ih-fg-3 mt-0.5">{r.location}</p>
                    )}
                    {r.comment && (
                      <p className="text-[13px] text-ih-fg-3 mt-2 leading-relaxed">{r.comment}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
