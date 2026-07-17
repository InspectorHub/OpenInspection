import type { useFetcher } from "react-router";
import type { WizardTeamMember } from "../NewInspectionWizard";
import { m } from "~/paraglide/messages";

type ConflictFetcher = ReturnType<
  typeof useFetcher<{
    conflicts: Array<{ inspectionId: string; propertyAddress: string; date: string }>;
  }>
>;

export function TeamStep({
  soloMode,
  setSoloMode,
  inspectorId,
  setInspectorId,
  teamMembers,
  conflictFetcher,
}: {
  soloMode: boolean;
  setSoloMode: (v: boolean) => void;
  inspectorId: string;
  setInspectorId: (v: string) => void;
  teamMembers: WizardTeamMember[];
  conflictFetcher: ConflictFetcher;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_team_mode_label()}</label>
        <div className="flex gap-2">
          <button onClick={() => setSoloMode(true)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${soloMode ? "border-ih-primary bg-ih-primary-tint text-ih-primary" : "border-ih-border text-ih-fg-3"}`}>{m.newinsp_team_solo()}</button>
          <button onClick={() => setSoloMode(false)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${!soloMode ? "border-ih-primary bg-ih-primary-tint text-ih-primary" : "border-ih-border text-ih-fg-3"}`}>{m.newinsp_team_team()}</button>
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
          {/* IA-6 — advisory conflict warning; non-blocking */}
          {(conflictFetcher.data?.conflicts?.length ?? 0) > 0 && (
            <div className="mt-2 rounded-md border border-ih-watch/40 bg-ih-watch-bg px-3 py-2">
              <p className="text-[12px] font-bold text-ih-watch-fg">
                <strong>{m.newinsp_conflict_title()}</strong>{" "}
                {conflictFetcher.data!.conflicts.length === 1
                  ? m.newinsp_conflict_one({ address: conflictFetcher.data!.conflicts[0].propertyAddress })
                  : m.newinsp_conflict_many({ count: conflictFetcher.data!.conflicts.length })}{" "}
                {m.newinsp_conflict_suffix()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
