/**
 * <FindingsBySection> — the section × rating-level matrix on /metrics.
 *
 * **One rating system at a time, never a merged table.** Rating systems are
 * per-tenant and not commensurable: `Defect`, `Deficient` and `Deficiency` name
 * one severity band in three vocabularies, so a union renders them as three
 * sparse columns; and a level's `order` is a per-system index, so a merged
 * header loses the left-to-right severity gradient that makes the table
 * readable at a glance. A row total spanning two systems counts real findings
 * but describes a distribution nobody can compare.
 *
 * So the server returns one self-contained matrix per system and this component
 * shows the busiest by default. When a tenant has only one system in use — the
 * common case — there is no selector and nothing to notice. When there is more
 * than one, the selector appears AND the count hidden behind it is stated: a
 * filtered view that does not say what it filtered is how a reader concludes
 * their data is missing.
 *
 * lint:ds — `ih-*` tokens only.
 */
import { useState } from "react";
import { Card, Select, Table } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface FindingsSystem {
  systemId: string;
  systemName: string;
  columns: { key: string; label: string; color: string }[];
  rows: { section: string; counts: Record<string, number>; total: number; unresolvedSection?: true }[];
  total: number;
}

export interface FindingsData {
  /** Ordered by volume server-side, so `[0]` is the default view. */
  systems: FindingsSystem[];
  total: number;
}

type FindingsRow = FindingsSystem["rows"][number];

export function FindingsBySection({ findings }: { findings: FindingsData | null }) {
  const systems = findings?.systems ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Fall back to the busiest rather than pinning an id in state on mount: the
  // range picker refetches, and a system that had findings last range may have
  // none in this one.
  const active = systems.find((s) => s.systemId === selectedId) ?? systems[0] ?? null;
  const hidden = (findings?.total ?? 0) - (active?.total ?? 0);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-sm font-bold text-ih-fg-1">{m.metrics_findings_title()}</p>
        {systems.length > 1 && (
          <Select
            bare
            aria-label={m.metrics_findings_system_aria()}
            value={active?.systemId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="max-w-[16rem]"
            options={systems.map((s) => ({
              value: s.systemId,
              label: m.metrics_findings_system_option({ name: s.systemName, count: s.total }),
            }))}
          />
        )}
      </div>

      {active && active.rows.length > 0 && active.columns.length > 0 ? (
        <>
          <Table<FindingsRow>
            rows={active.rows}
            getRowKey={(row) => row.section}
            columns={[
              {
                label: m.metrics_col_section(),
                cell: (row) =>
                  row.unresolvedSection ? (
                    <span className="font-medium text-ih-fg-3" title={m.metrics_section_removed_hint()}>
                      {m.metrics_section_removed()}
                    </span>
                  ) : (
                    <span className="font-medium text-ih-fg-1">{row.section}</span>
                  ),
              },
              ...active.columns.map((col) => ({
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                    {col.label}
                  </span>
                ),
                align: "center" as const,
                cell: (row: FindingsRow) => (
                  <span className={row.counts[col.key] ? "text-ih-fg-2" : "text-ih-fg-4"}>
                    {row.counts[col.key] ?? "—"}
                  </span>
                ),
              })),
              {
                label: m.metrics_col_total(),
                align: "right" as const,
                cell: (row: FindingsRow) => <span className="font-bold text-ih-fg-1">{row.total}</span>,
              },
            ]}
          />
          {hidden > 0 && (
            <p className="mt-3 text-[12px] text-ih-fg-3">{m.metrics_findings_other_systems({ count: hidden })}</p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_findings()}</p>
      )}
    </Card>
  );
}
