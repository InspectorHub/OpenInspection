import { useMemo } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-items";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader } from "@core/shared-ui";
import { propertyGroupKey, inspectionDateValue } from "~/lib/property-groups";
import type { RepairDefectPhoto } from "~/components/portal/sections/repair/RepairDefectRowView";
import {
  AgentRepairInspectionBlock,
  type AgentRepairRow,
} from "~/components/agent/AgentRepairInspectionBlock";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_recommendations_meta_title() }];
}

/** A block row plus the property/company context this page groups by. */
export interface RepairItemRow extends AgentRepairRow {
  tenantName: string;
  tenantSlug: string;
  propertyAddress: string | null;
  inspectionDate: string | null;
}

/** One row of the canonical report defect list (GET .../source). */
interface SourceDefect {
  findingKey: string;
  sectionTitle: string;
  itemLabel: string;
  defectTitle?: string | null;
  location?: string | null;
  category?: string | null;
  comment?: string | null;
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
function agentPhotos(row: AgentRepairRow): RepairDefectPhoto[] {
  return (row.photos ?? []).map((key) => ({
    key,
    url: `/api/agent/inspections/${row.inspectionId}/photo?key=${encodeURIComponent(key)}&w=320`,
  }));
}

interface ExistingList {
  shareToken: string | null;
  createdAt: string | number | Date;
  expiresAt: string | number | Date | null;
  revokedAt: string | number | Date | null;
  items?: unknown[];
}

function toMillis(v: string | number | Date | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * The newest still-usable list this agent already has for the inspection.
 * Sharing twice must hand out the SAME link — a second row would leave the
 * client holding a link the agent thinks they revoked. Expired and revoked
 * rows are skipped: their links are already dead, so reusing one would
 * silently share nothing.
 */
export function pickLiveShareToken(mine: ExistingList[], now: number): ExistingList | null {
  const live = mine.filter((rr) => {
    if (!rr.shareToken || rr.revokedAt) return false;
    const expires = toMillis(rr.expiresAt);
    return expires === null || expires > now;
  });
  if (live.length === 0) return null;
  return live.reduce((newest, rr) =>
    (toMillis(rr.createdAt) ?? 0) > (toMillis(newest.createdAt) ?? 0) ? rr : newest,
  );
}

/**
 * Delivery reuses the client repair-builder's per-inspection share channel:
 * mint-or-reuse the `repair_requests` row for this inspection, populate it from
 * the canonical report defect list, and hand back the `/repair-request/:token`
 * page the client builder already produces. No second share mechanism, and no
 * aggregate link across properties — the channel is per-inspection by design.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = String(form.get("_intent") ?? "");
  const api = createApi(context, { token });

  try {
    if (intent === "send-email") {
      const shareToken = String(form.get("shareToken") ?? "");
      const to = String(form.get("to") ?? "");
      const message = (form.get("message") as string | null) ?? undefined;
      if (!shareToken || !to) return { ok: false as const, error: m.repair_builder_error_missing_recipient() };
      const res = await api.repairBuilder["repair-request"].share[":shareToken"].email.$post({
        param: { shareToken },
        json: { to, message },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_send_email() };
      return { ok: true as const };
    }

    if (intent !== "share") {
      return { ok: false as const, error: m.repair_builder_error_unknown_intent({ intent }) };
    }

    const inspectionId = String(form.get("inspectionId") ?? "");
    const tenant = String(form.get("tenantSlug") ?? "");
    if (!inspectionId || !tenant) {
      return { ok: false as const, error: m.repair_builder_error_create_list() };
    }

    // The source endpoint authorizes this agent for THIS inspection (the agent
    // session path in resolveBuilderAccess) and returns the canonical defect
    // list with its stable findingKeys — the same input the client builder uses.
    const srcRes = await api.repairBuilder["repair-builder"][":tenant"][":id"].source.$get({
      param: { tenant, id: inspectionId },
      query: {},
    });
    if (!srcRes.ok) return { ok: false as const, error: m.repair_builder_error_create_list() };
    const src = (await srcRes.json()) as { data?: { defects?: SourceDefect[]; mine?: ExistingList[] } };
    const defects = src.data?.defects ?? [];

    const existing = pickLiveShareToken(src.data?.mine ?? [], Date.now());
    if (existing?.shareToken && (existing.items?.length ?? 0) > 0) {
      return { ok: true as const, inspectionId, shareToken: existing.shareToken };
    }

    let rr = existing as (ExistingList & { id?: string }) | null;
    if (!rr) {
      const createRes = await api.repairBuilder["repair-builder"][":tenant"][":id"].$post({
        param: { tenant, id: inspectionId },
        query: {},
      });
      if (!createRes.ok) return { ok: false as const, error: m.repair_builder_error_create_list() };
      const created = (await createRes.json()) as { data?: ExistingList & { id: string } };
      rr = created.data ?? null;
    }
    const rrId = (rr as { id?: string } | null)?.id;
    if (!rr?.shareToken || !rrId) return { ok: false as const, error: m.repair_builder_error_create_list() };

    // The agent forwards the whole list, so every defect goes on it with no
    // credit — asking for money is the client's decision, made in their own
    // builder, not the agent's.
    for (const d of defects) {
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items.$post({
        param: { tenant, id: inspectionId, rrId },
        query: {},
        json: {
          findingKey: d.findingKey,
          sectionTitle: d.sectionTitle,
          itemLabel: d.itemLabel,
          defectTitle: d.defectTitle ?? null,
          location: d.location ?? null,
          category: d.category ?? null,
          commentSnapshot: d.comment ?? null,
          requestedCreditCents: null,
          note: null,
        },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_add_item() };
    }

    return { ok: true as const, inspectionId, shareToken: rr.shareToken };
  } catch {
    return { ok: false as const, error: m.repair_builder_error_server() };
  }
}

interface InspectionBlock {
  inspectionId: string;
  tenantName: string;
  tenantSlug: string;
  repairAccess: AgentRepairRow["repairAccess"];
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
        repairAccess: row.repairAccess,
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
                <AgentRepairInspectionBlock
                  key={block.inspectionId}
                  inspectionId={block.inspectionId}
                  tenantName={block.tenantName}
                  tenantSlug={block.tenantSlug}
                  repairAccess={block.repairAccess}
                  rows={block.rows}
                  photosFor={agentPhotos}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
