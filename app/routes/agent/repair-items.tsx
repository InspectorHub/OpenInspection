import { useMemo } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-items";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader } from "@core/shared-ui";
import { propertyGroupKey, inspectionDateValue } from "~/lib/property-groups";
import {
  RepairDefectRowView,
  type RepairDefectPhoto,
} from "~/components/portal/sections/repair/RepairDefectRowView";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_recommendations_meta_title() }];
}

export interface RepairItemRow {
  inspectionId: string;
  tenantName: string;
  tenantSlug: string;
  propertyAddress: string | null;
  inspectionDate: string | null;
  sectionTitle: string;
  itemLabel: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
  // A defect_categories.id or legacy seed name — kept verbatim (IA-41).
  category: string;
  isCustom: boolean;
  photos: string[];
}

const FIXED_CATEGORIES = new Set(["safety", "recommendation", "maintenance"]);

// Ordering within one inspection: what could hurt someone first, upkeep last.
// Anything else (a tenant custom category) sorts with recommendations.
const CATEGORY_RANK: Record<string, number> = { safety: 0, recommendation: 1, maintenance: 2 };
function categoryRank(category: string): number {
  return CATEGORY_RANK[category] ?? 1;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.agent["my-repair-items"].$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown>;
    // The endpoint still answers in category buckets (a legitimate API shape for
    // other consumers); this page's structure is the property, so flatten here
    // and let each row carry its own category.
    const items = (["safety", "recommendation", "maintenance"] as const).flatMap((key) =>
      Array.isArray(d?.[key]) ? (d[key] as RepairItemRow[]) : [],
    );
    return { items };
  } catch {
    return { items: [] as RepairItemRow[] };
  }
}

/**
 * Defect photo keys resolve through the AGENT photo route. The editor route is
 * tenant-staff-only and the public one wants a portal token — an agent session
 * satisfies neither, so pointing at either silently renders broken images.
 */
function agentPhotos(row: RepairItemRow): RepairDefectPhoto[] {
  return (row.photos ?? []).map((key) => ({
    key,
    url: `/api/agent/inspections/${row.inspectionId}/photo?key=${encodeURIComponent(key)}&w=320`,
  }));
}

interface InspectionBlock {
  inspectionId: string;
  tenantName: string;
  tenantSlug: string;
  date: string | null;
  rows: RepairItemRow[];
}

interface PropertySection {
  key: string;
  label: string;
  recency: number;
  blocks: InspectionBlock[];
}

/**
 * Property sections, each holding one block per inspection. The property is the
 * agent's unit of work (the deal), so it heads the section; delivery is strictly
 * per-inspection, so the inspection block is what an action can attach to.
 */
export function groupByProperty(items: RepairItemRow[]): PropertySection[] {
  const sections = new Map<string, PropertySection>();
  for (const row of items) {
    const key = propertyGroupKey(row.propertyAddress, row.inspectionId);
    const section = sections.get(key) ?? {
      key,
      label: row.propertyAddress?.trim() || m.agent_portal_no_address(),
      recency: -Infinity,
      blocks: [],
    };
    let block = section.blocks.find((b) => b.inspectionId === row.inspectionId);
    if (!block) {
      block = {
        inspectionId: row.inspectionId,
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        date: row.inspectionDate,
        rows: [],
      };
      section.blocks.push(block);
    }
    block.rows.push(row);
    section.recency = Math.max(section.recency, inspectionDateValue(row.inspectionDate));
    sections.set(key, section);
  }
  for (const section of sections.values()) {
    section.blocks.sort((a, b) => inspectionDateValue(b.date) - inspectionDateValue(a.date));
    for (const block of section.blocks) {
      block.rows.sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
    }
  }
  return Array.from(sections.values()).sort((a, b) => b.recency - a.recency);
}

export default function AgentRepairItemsPage() {
  const { items } = useLoaderData<typeof loader>();
  const sections = useMemo(() => groupByProperty(items), [items]);
  // Findings carrying a tenant custom category still reach the agent (IA-41);
  // say so rather than letting the unfamiliar word look like a glitch.
  const customCount = items.filter((r) => !FIXED_CATEGORIES.has(r.category)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.agent_portal_repair_items()}
        meta={
          <>
            {m.agent_portal_recommendations_meta()}
            {items.length > 0 && m.agent_portal_recommendations_total({ count: items.length })}
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

      {sections.length === 0 ? (
        <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
          <p className="text-[13px] text-ih-fg-3">{m.agent_portal_repair_empty()}</p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border">
              <span className="w-1 h-6 rounded bg-ih-primary" />
              <h2 className="text-sm font-bold text-ih-fg-1 truncate">{section.label}</h2>
              <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest ml-auto shrink-0">
                {section.blocks.reduce((n, b) => n + b.rows.length, 0)}{" "}
                {section.blocks.reduce((n, b) => n + b.rows.length, 0) === 1
                  ? m.agent_portal_recommendations_item_one()
                  : m.agent_portal_recommendations_item_other()}
              </span>
            </div>
            <div className="divide-y divide-ih-border">
              {section.blocks.map((block) => (
                <div key={block.inspectionId} data-testid={`repair-inspection-${block.inspectionId}`} className="p-5 space-y-3">
                  <p className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
                    {block.tenantName}
                  </p>
                  {block.rows.map((row, i) => (
                    <div
                      key={`${row.inspectionId}-${row.defectTitle}-${i}`}
                      className="flex items-start gap-3 p-4 border border-ih-border rounded-md bg-ih-bg-app/30"
                    >
                      <RepairDefectRowView
                        sectionTitle={row.sectionTitle}
                        itemLabel={row.itemLabel}
                        defectTitle={row.defectTitle}
                        location={row.location}
                        comment={row.comment}
                        category={row.category}
                        isCustom={row.isCustom}
                        photos={agentPhotos(row)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
