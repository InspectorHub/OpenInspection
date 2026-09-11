import { SettingToggle } from "./SettingToggle";
import { m } from "~/paraglide/messages";

/**
 * Settings → Company: "Report features" section. One opt-in capability that
 * changes what a published report OFFERS the client — the client's ability to
 * build a repair request from it. Defaults OFF: a company that has not chosen
 * to work that way should not have their reports grow buttons.
 *
 * A second toggle, "Show repair list tab" (`enableRepairList` /
 * `tenant_configs.is_repair_list_enabled`), used to sit above it. Nothing ever
 * rendered a Repair List tab: the button meant to open one pointed at a page
 * route that never existed and was removed, leaving a switch whose label
 * promised a capability the product does not have. It is gone rather than
 * wired — see the column's note in `server/lib/db/schema/tenant/core.ts`.
 *
 * Presentational — the route owns the Conform form and the save action; this is
 * an uncontrolled checkbox read straight off the submitted FormData.
 */
export function ReportFeaturesPanel({
  enableCustomerRepairExport,
}: {
  enableCustomerRepairExport: boolean | null | undefined;
}) {
  return (
    <section id="report-features" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_features_heading()}</h3>

      <SettingToggle
        name="enableCustomerRepairExport"
        defaultChecked={enableCustomerRepairExport ?? false}
        title={m.settings_workspace_repair_export_title()}
        description={m.settings_workspace_repair_export_desc()}
      />
    </section>
  );
}
