import type { useFetcher } from "react-router";
import type { WizardTeamMember } from "../NewInspectionWizard";
import { ScheduleStep } from "./ScheduleStep";
import { TeamStep } from "./TeamStep";
import { formatPriceCents } from "~/lib/wizard-steps";
import type { NewInspectionSummary } from "~/lib/wizard-review";
import { formatInspectionDateTime } from "~/lib/format-date";
import { civilToInstantISO } from "~/lib/civil-time";
import { m } from "~/paraglide/messages";

type ConflictFetcher = ReturnType<
    typeof useFetcher<{
        conflicts: Array<{ inspectionId: string; propertyAddress: string; date: string }>;
    }>
>;

type HolidayFetcher = ReturnType<
    typeof useFetcher<{ effect: "none" | "block" | "advisory"; name: string | null }>
>;

function ReviewRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 py-1.5">
            <span className="text-[12px] text-ih-fg-3 shrink-0">{label}</span>
            <span className="text-[12px] text-ih-fg-1 text-right">{value}</span>
        </div>
    );
}

/**
 * The wizard's final step.
 *
 * Schedule and Team were a step each, and each held exactly one decision — a
 * date, and a two-way radio. Whichever of them came last was where "Create"
 * lived, which meant the wizard's last screen showed one field and no statement
 * of what pressing Create would produce. A wrong template or a mistyped client
 * from step 1 could not be checked from the place where it mattered.
 *
 * So both controls live here, above a review of every answer. Rows with no
 * answer are omitted rather than shown blank: People and Services are legal
 * skips, and "Client: —" reads like a field someone forgot.
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
    summary,
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
    summary: NewInspectionSummary;
}) {
    // Show the appointment as the product will: the same wall clock the inspector
    // typed, rendered in the zone that was named next to the field.
    const scheduledIso = civilToInstantISO(date, time, timeZone);

    return (
        <div className="space-y-5">
            <section className="space-y-3">
                <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">
                    {m.new_inspection_step_schedule()}
                </p>
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

            <section className="rounded-md border border-ih-border bg-ih-bg-muted px-3 py-2.5">
                <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide mb-1">
                    {m.newinsp_review_heading()}
                </p>
                <div className="divide-y divide-ih-border">
                    <ReviewRow label={m.newinsp_review_address()} value={summary.address} />
                    {summary.template && (
                        <ReviewRow label={m.newinsp_review_template()} value={summary.template} />
                    )}
                    {scheduledIso && (
                        <ReviewRow
                            label={m.newinsp_review_when()}
                            value={formatInspectionDateTime(scheduledIso, undefined, timeZone)}
                        />
                    )}
                    {summary.client && (
                        <ReviewRow label={m.newinsp_review_client()} value={summary.client} />
                    )}
                    {summary.agent && <ReviewRow label={m.newinsp_review_agent()} value={summary.agent} />}
                    {summary.services && (
                        <ReviewRow
                            label={m.newinsp_review_services()}
                            value={`${summary.services.names.join(", ")} · ${formatPriceCents(summary.services.totalCents)}`}
                        />
                    )}
                    <ReviewRow
                        label={m.newinsp_review_assignee()}
                        value={summary.assignee ?? m.newinsp_review_assignee_you()}
                    />
                </div>
            </section>
        </div>
    );
}
