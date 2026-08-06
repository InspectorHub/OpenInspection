import { SettingToggle } from "./SettingToggle";
import { m } from "~/paraglide/messages";

/**
 * Settings → Company: "Report features" section. Two opt-in capabilities that
 * change what a published report OFFERS the client — the repair list itself,
 * and the client's ability to export it. Both default OFF: a company that has
 * not chosen to work that way should not have their reports grow buttons.
 *
 * Presentational — the route owns the Conform form and the save action; these
 * are uncontrolled checkboxes read straight off the submitted FormData.
 */
export function ReportFeaturesPanel({
  enableRepairList,
  enableCustomerRepairExport,
}: {
  enableRepairList: boolean | null | undefined;
  enableCustomerRepairExport: boolean | null | undefined;
}) {
  return (
    <section id="report-features" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_features_heading()}</h3>

      <SettingToggle
        name="enableRepairList"
        defaultChecked={enableRepairList ?? false}
        title={m.settings_workspace_repair_list_title()}
        description={m.settings_workspace_repair_list_desc()}
      />

      <SettingToggle
        name="enableCustomerRepairExport"
        defaultChecked={enableCustomerRepairExport ?? false}
        title={m.settings_workspace_repair_export_title()}
        description={m.settings_workspace_repair_export_desc()}
      />
    </section>
  );
}
