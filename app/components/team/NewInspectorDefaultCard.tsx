import { Card, Checkbox } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";

/**
 * The company default for inspectors invited from now on: see every inspection, or only the ones
 * assigned to them. It is read when an invite is created and never reaches an existing member, which
 * the line under the switch says, because a switch on a team page invites the opposite assumption.
 *
 * Shown to owners and managers only (the caller decides). The saved value is the loader's; while a save
 * is in flight the switch shows the value being saved, and a failed save leaves the loader's value and says so.
 */
export function NewInspectorDefaultCard({ viewAll }: { viewAll: boolean }) {
  const { submit, fetcher, busy } = useGuardedSubmit<{ ok: boolean; error?: string }>();
  const pending = fetcher.formData?.get("viewAll");
  const checked = pending != null ? pending === "true" : viewAll;

  function change(next: boolean) {
    submit({ intent: "set-new-inspector-default", viewAll: String(next) }, { method: "post" });
  }

  return (
    <Card className="p-4 space-y-1">
      <Checkbox
        label={m.team_defaults_new_inspectors_title()}
        checked={checked}
        disabled={busy}
        onChange={(e) => change(e.target.checked)}
      />
      <p className="text-[12px] text-ih-fg-3 pl-6">{m.team_defaults_new_inspectors_desc()}</p>
      {fetcher.data && !fetcher.data.ok && fetcher.state === "idle" && (
        <p role="alert" className="text-xs text-ih-bad-fg font-semibold pl-6">{fetcher.data.error || m.team_defaults_save_failed()}</p>
      )}
    </Card>
  );
}
