import type { WizardTeamMember } from "../NewInspectionWizard";
import { m } from "~/paraglide/messages";

/**
 * Assignee picker. Rendered inside the final Confirm step, not as a step of its
 * own — it is one decision, and a screen per decision is what made the wizard
 * end without ever showing what it would create.
 *
 * The schedule-conflict warning used to be repeated here as well as on the
 * Schedule step. Now that both are on the same screen it is stated once, next to
 * the date and time that cause it.
 */
export function TeamStep({
  soloMode,
  setSoloMode,
  inspectorId,
  setInspectorId,
  teamMembers,
}: {
  soloMode: boolean;
  setSoloMode: (v: boolean) => void;
  inspectorId: string;
  setInspectorId: (v: string) => void;
  teamMembers: WizardTeamMember[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_team_mode_label()}</label>
        <div className="flex gap-2">
          <button onClick={() => setSoloMode(true)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${soloMode ? "border-ih-primary bg-ih-primary-tint text-ih-primary-text" : "border-ih-border text-ih-fg-3"}`}>{m.newinsp_team_solo()}</button>
          <button onClick={() => setSoloMode(false)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${!soloMode ? "border-ih-primary bg-ih-primary-tint text-ih-primary-text" : "border-ih-border text-ih-fg-3"}`}>{m.newinsp_team_team()}</button>
        </div>
      </div>
      {!soloMode && (
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_team_inspector_label()}</label>
          {teamMembers.length > 0 ? (
            <select
              value={inspectorId}
              onChange={(e) => setInspectorId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none"
            >
              <option value="">{m.newinsp_team_select_option()}</option>
              {teamMembers.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </select>
          ) : (
            <input value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} placeholder={m.newinsp_team_inspector_ph()} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
          )}
        </div>
      )}
    </div>
  );
}
