import { m } from "~/paraglide/messages";
import type { ProfileRow } from "./types";

const GROUP_ORDER = ["identity", "physical", "occupancy", "compliance", "utilities", "maintenance"];

/**
 * Commercial PCA Phase F — Building Profile fact list. Renders property facts
 * at the top of the report. Only rendered when at least one row is populated;
 * rows are produced server-side by `resolveBuildingProfile` (presets stay
 * server-only). Groups follow GROUP_ORDER; any unknown group is appended under
 * its raw key.
 */
export function BuildingProfile({ rows }: { rows: ProfileRow[] }) {
  if (!rows.length) return null;

  const GROUP_LABEL: Record<string, string> = {
    identity: m.pca_building_profile_group_identity(),
    physical: m.pca_building_profile_group_physical(),
    occupancy: m.pca_building_profile_group_occupancy(),
    compliance: m.pca_building_profile_group_compliance(),
    utilities: m.pca_building_profile_group_utilities(),
    maintenance: m.pca_building_profile_group_maintenance(),
  };
  const known = new Set(GROUP_ORDER);
  const extraGroups = Array.from(new Set(rows.map((r) => r.group))).filter((g) => !known.has(g));
  const groups = [...GROUP_ORDER, ...extraGroups]
    .map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) }))
    .filter((g) => g.rows.length > 0);

  return (
    <section className="mb-6 rounded-lg border border-ih-border bg-ih-bg-card p-4 print:break-inside-avoid">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ih-fg-3">{m.pca_building_profile_title()}</h2>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.group}>
            <h3 className="mb-1 text-xs font-medium text-ih-fg-4">{GROUP_LABEL[g.group] ?? g.group}</h3>
            <dl className="space-y-1">
              {g.rows.map((r) => (
                <div key={r.id} className="flex justify-between gap-4 text-sm">
                  <dt className="text-ih-fg-3">{r.label}</dt>
                  <dd className="text-ih-fg-1">{r.value}{r.unit ? ` ${r.unit}` : ""}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
