import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-items";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_recommendations_meta_title() }];
}

interface Recommendation {
  inspectionId: string;
  propertyAddress: string | null;
  sectionTitle: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
  // IA-41 — the real defect category (may be a tenant custom category) + whether
  // the inspector added it in the field.
  category: string;
  isCustom: boolean;
}

const FIXED_CATEGORIES = new Set(["safety", "recommendation", "maintenance"]);

interface Groups {
  safety: Recommendation[];
  recommendation: Recommendation[];
  maintenance: Recommendation[];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.agent["my-repair-items"].$get();
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
  { key: "safety" as const, color: "text-ih-bad-fg" },
  { key: "recommendation" as const, color: "text-ih-watch-fg" },
  { key: "maintenance" as const, color: "text-ih-info-fg" },
];

// Resolved at call time (not module load) so paraglide's ALS scope is active.
function groupLabel(key: "safety" | "recommendation" | "maintenance"): string {
  switch (key) {
    case "safety":
      return m.agent_portal_repair_group_safety();
    case "recommendation":
      return m.agent_portal_repair_group_recommendation();
    case "maintenance":
      return m.agent_portal_repair_group_maintenance();
  }
}

export default function AgentRecommendationsPage() {
  const { groups } = useLoaderData<typeof loader>();
  const total = groups.safety.length + groups.recommendation.length + groups.maintenance.length;
  // IA-41 — findings tagged with a tenant custom category are merged into
  // Recommendations (matching the PCA summary). Tell the reader when that
  // happened rather than letting them silently vanish.
  const customCount = groups.recommendation.filter((r) => !FIXED_CATEGORIES.has(r.category)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.agent_portal_repair_items()}
        meta={
          <>
            {m.agent_portal_recommendations_meta()}
            {total > 0 && m.agent_portal_recommendations_total({ count: total })}
          </>
        }
        actions={
          <button
            onClick={() => window.print()}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors shrink-0"
          >
            {m.agent_portal_recommendations_print()}
          </button>
        }
      />

      {customCount > 0 && (
        <p className="text-[12px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md px-3 py-2">
          {customCount === 1
            ? m.agent_portal_repair_custom_note_one()
            : m.agent_portal_repair_custom_note_other({ count: customCount })}
        </p>
      )}

      {GROUP_META.map(({ key, color }) => {
        const items = groups[key];
        const label = groupLabel(key);
        return (
          <section key={key} className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-ih-border">
              <h2 className={`text-lg font-bold ${color}`}>{label}</h2>
              <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
                {items.length} {items.length === 1 ? m.agent_portal_recommendations_item_one() : m.agent_portal_recommendations_item_other()}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="text-[13px] text-ih-fg-4 py-2">
                {m.agent_portal_recommendations_empty({ label: label.toLowerCase() })}
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((r, i) => (
                  <div key={`${r.inspectionId}-${r.defectTitle}-${i}`} className="p-4 border border-ih-border rounded-md bg-ih-bg-app/30">
                    <p className="text-[11px] font-mono text-ih-fg-4 mb-1">
                      {r.propertyAddress || m.agent_portal_no_address()} &middot; {r.sectionTitle}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-ih-fg-1">{r.defectTitle}</p>
                      {r.isCustom && (
                        <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3">
                          {m.agent_portal_repair_inspector_added()}
                        </span>
                      )}
                    </div>
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
