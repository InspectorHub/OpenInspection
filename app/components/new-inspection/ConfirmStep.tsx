import type { useFetcher } from "react-router";
import type { WizardTeamMember } from "../NewInspectionWizard";
import { ScheduleStep } from "./ScheduleStep";
import { TeamStep } from "./TeamStep";
import { m } from "~/paraglide/messages";
import { FindATimeLauncher } from "./FindATimeLauncher";

type ConflictFetcher = ReturnType<
    typeof useFetcher<{
        conflicts: Array<{ inspectionId: string; propertyAddress: string; date: string }>;
    }>
>;

type HolidayFetcher = ReturnType<
    typeof useFetcher<{ effect: "none" | "block" | "advisory"; name: string | null }>
>;

/**
 * The wizard's final step.
 *
 * Schedule and Team were a step each, and each held exactly one decision — a
 * date, and a two-way radio. Whichever came last was where "Create" lived, so
 * the wizard's last screen showed one field and no statement of what pressing
 * Create would produce. Both controls live here now.
 *
 * The review that used to sit under them moved out to `ReviewPanel`, beside the
 * form for every step: read once at the end it could only catch a mistake after
 * the fact, and its rows are now the way back to the step that owns them.
 */
export function ConfirmStep({
    date,
    setDate,
    time,
    setTime,
    timeZone,
    conflictFetcher,
    holidayFetcher,
    showTeam,
    soloMode,
    setSoloMode,
    inspectorId,
    setInspectorId,
    teamMembers,
}: {
    date: string;
    setDate: (v: string) => void;
    time: string;
    setTime: (v: string) => void;
    timeZone: string;
    conflictFetcher: ConflictFetcher;
    holidayFetcher: HolidayFetcher;
    /** False in a solo workspace — there is nobody to assign to, so the control is not offered. */
    showTeam: boolean;
    soloMode: boolean;
    setSoloMode: (v: boolean) => void;
    inspectorId: string;
    setInspectorId: (v: string) => void;
    teamMembers: WizardTeamMember[];
}) {
    return (
        <div className="space-y-5">
            <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">
                        {m.new_inspection_step_schedule()}
                    </p>
                    {/* The picker below asks "when do you want it"; this asks
                        "when could it actually happen". It lives here because a
                        chosen slot writes THREE of this step's fields at once. */}
                    <FindATimeLauncher
                        date={date}
                        teamMembers={teamMembers}
                        onPick={(pick) => {
                            setDate(pick.date);
                            setTime(pick.time);
                            if (pick.inspectorId) {
                                setInspectorId(pick.inspectorId);
                                setSoloMode(false);
                            }
                        }}
                    />
                </div>
                <ScheduleStep
                    date={date}
                    setDate={setDate}
                    time={time}
                    setTime={setTime}
                    conflictFetcher={conflictFetcher}
                    holidayFetcher={holidayFetcher}
                    timeZone={timeZone}
                />
            </section>

            {showTeam && (
                <section className="space-y-3">
                    <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">
                        {m.new_inspection_step_team()}
                    </p>
                    <TeamStep
                        soloMode={soloMode}
                        setSoloMode={setSoloMode}
                        inspectorId={inspectorId}
                        setInspectorId={setInspectorId}
                        teamMembers={teamMembers}
                    />
                </section>
            )}

        </div>
    );
}
