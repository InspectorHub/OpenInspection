import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Input, Select } from "@core/shared-ui";
import type { action } from "~/routes/settings-booking";
import { m } from "~/paraglide/messages";

export interface ServiceAreaMember {
  id: string;
  email: string;
  /** ZIP prefixes this inspector serves. Empty = serves everywhere. */
  zipPrefixes: string[];
  /** Their own start address, or null when inheriting the company one. */
  originAddress: string | null;
  /** True when that override actually resolved to coordinates. */
  originLocated: boolean;
}

/** "78701, 787 ,, 73301" -> ["78701","787","73301"] */
export function parseZipList(raw: string): string[] {
  return [...new Set(
    raw.split(/[,\s]+/).map((z) => z.trim().toUpperCase()).filter(Boolean),
  )];
}

/**
 * Per-inspector territory + service origin.
 *
 * Two settings, one panel, because they answer the same question from two
 * sides: WHERE will this person travel, and WHERE do they start. Splitting
 * them would put the ZIP list next to routing and the origin next to the
 * profile, and nobody would find the second one.
 *
 * The empty state is load-bearing and stated, not implied: no ZIPs means
 * serves everywhere, which is what the server does and what a workspace that
 * never opens this panel gets.
 */
export function InspectorServiceAreasPanel({ members }: { members: ServiceAreaMember[] }) {
  const fetcher = useFetcher<typeof action>();
  const [selectedId, setSelectedId] = useState(members[0]?.id ?? "");
  const selected = members.find((x) => x.id === selectedId) ?? null;

  const [zips, setZips] = useState(selected?.zipPrefixes.join(", ") ?? "");
  const [origin, setOrigin] = useState(selected?.originAddress ?? "");

  // Switching inspector must load THEIR values, not keep the last person's —
  // a stale box here saves one inspector's territory onto another.
  useEffect(() => {
    const next = members.find((x) => x.id === selectedId) ?? null;
    setZips(next?.zipPrefixes.join(", ") ?? "");
    setOrigin(next?.originAddress ?? "");
  }, [selectedId, members]);

  const saving = fetcher.state !== "idle";
  const result =
    fetcher.state === "idle" &&
    (fetcher.data?.intent === "service-areas-save" || fetcher.data?.intent === "service-origin-save")
      ? fetcher.data
      : null;

  if (members.length === 0) {
    return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_serviceareas_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-2">{m.settings_serviceareas_no_members()}</p>
      </section>
    );
  }

  const parsed = parseZipList(zips);

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_serviceareas_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_serviceareas_desc()}</p>
      </div>

      <div className="max-w-sm">
        <Select
          label={m.settings_serviceareas_inspector_label()}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          options={members.map((x) => ({
            value: x.id,
            label: x.zipPrefixes.length > 0
              ? m.settings_serviceareas_option_with_zips({ email: x.email, count: x.zipPrefixes.length })
              : m.settings_serviceareas_option_all_areas({ email: x.email }),
          }))}
        />
      </div>

      <div className="space-y-2">
        <Input
          label={m.settings_serviceareas_zips_label()}
          value={zips}
          placeholder="78701, 787, 73301"
          hint={m.settings_serviceareas_zips_hint()}
          onChange={(e) => setZips(e.target.value)}
        />
        <p className="text-[11px] text-ih-fg-4">
          {parsed.length === 0
            ? m.settings_serviceareas_empty_state()
            : m.settings_serviceareas_parsed({ list: parsed.join(", ") })}
        </p>
        <button
          type="button"
          disabled={saving || !selectedId}
          onClick={() => fetcher.submit(
            { intent: "service-areas-save", userId: selectedId, zipPrefixes: parsed.join(",") },
            { method: "post" },
          )}
          className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? m.settings_holiday_save_pending() : m.settings_serviceareas_save()}
        </button>
      </div>

      <div className="space-y-2 border-t border-ih-border pt-4">
        <Input
          label={m.settings_serviceareas_origin_label()}
          value={origin}
          placeholder={m.settings_serviceareas_origin_placeholder()}
          hint={m.settings_serviceareas_origin_hint()}
          onChange={(e) => setOrigin(e.target.value)}
        />
        <p className="text-[11px] text-ih-fg-4">
          {origin.trim() === ""
            ? m.settings_serviceareas_origin_inherits()
            : selected?.originLocated
              ? m.settings_serviceareas_origin_located()
              : m.settings_serviceareas_origin_unlocated()}
        </p>
        <button
          type="button"
          disabled={saving || !selectedId}
          onClick={() => fetcher.submit(
            { intent: "service-origin-save", userId: selectedId, address: origin },
            { method: "post" },
          )}
          className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-40"
        >
          {saving ? m.settings_holiday_save_pending() : m.settings_serviceareas_origin_save()}
        </button>
      </div>

      {result && (
        <p className={`text-[13px] font-bold ${result.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}>
          {result.message ?? (result.ok ? m.settings_holiday_saved() : m.settings_holiday_save_failed())}
        </p>
      )}
    </section>
  );
}
