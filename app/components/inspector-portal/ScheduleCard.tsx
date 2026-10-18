import { useState } from "react";
import { Card, Button, Modal } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useInspectionDateTimeFormat } from "~/hooks/useSessionContext";
import { toLocalInputValue, fromLocalInputValue } from "~/lib/datetime-local";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspector-portal";

export interface TeamMember {
    id: string;
    name: string;
    email: string;
}

/**
 * When the inspection happens and who runs it.
 *
 * Both facts were read-only here and editable only from the report editor's
 * settings sheet, which is the wrong place twice over: they describe the order,
 * not the report, and the card that displayed them sent you somewhere else to
 * change them ("Reschedule in editor"). They are edited here now.
 *
 * The date field is `datetime-local`, not `date`. The settings sheet used a
 * date-only input whose BFF sanitizer stamped 09:00 onto whatever came back, so
 * saving an unrelated field on a 2 PM inspection silently moved it to the
 * morning. Keeping the time in the control is what stops that.
 */
export function ScheduleCard({
    inspectionId,
    date,
    inspectorId,
    inspectorName,
    members,
    membersStatus = "ready",
    onRequestMembers,
    onRetryMembers,
    displayTz,
    canEdit = true,
}: {
    inspectionId: string;
    date: string | null;
    inspectorId: string | null;
    inspectorName: string | null;
    members: TeamMember[];
    /**
     * Whether `members` has arrived. The list loads when the editor is first
     * opened; until it is `ready` the picker and Save are off, because a picker
     * with no list to show reads as "no inspector" and saving would unassign the
     * one the inspection has. Defaults to ready for callers that already hold it.
     */
    membersStatus?: "idle" | "loading" | "ready" | "error";
    /** Called when the editor opens, so the list can start loading. */
    onRequestMembers?: () => void;
    onRetryMembers?: () => void;
    displayTz: string;
    /** False once an office user's window to change who, where and when has closed (the inspection has started). */
    canEdit?: boolean;
}) {
    const fmt = useInspectionDateTimeFormat();
    const [open, setOpen] = useState(false);
    // #106 — rescheduling moves the appointment and reassigns the inspector.
    const { fetcher, submit, busy: saving } = useGuardedSubmit<typeof action>();

    const membersReady = membersStatus === "ready";
    const statusId = `hub-schedule-members-status-${inspectionId}`;

    const save = (form: HTMLFormElement) => {
        // Enter in the date field submits the form whatever the buttons say.
        if (!membersReady) return;
        const data = new FormData(form);
        const local = String(data.get("date") ?? "");
        const nextInspector = String(data.get("inspectorId") ?? "");
        const sent = submit(
            {
                intent: "save-order",
                payload: JSON.stringify({
                    // An emptied field means "leave the date alone" rather than
                    // "unschedule": the PATCH schema has no null for `date`, and
                    // pretending otherwise would swallow the save.
                    ...(local ? { date: fromLocalInputValue(local) } : {}),
                    inspectorId: nextInspector === "" ? null : nextInspector,
                }),
            },
            { method: "post" },
        );
        // Close only on a call the guard accepted.
        if (sent) setOpen(false);
    };

    const error =
        fetcher.state === "idle" && fetcher.data?.intent === "save-order" && !fetcher.data.ok
            ? fetcher.data.error
            : undefined;

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_block_schedule()} />
            <p className="text-[15px] font-medium text-ih-fg-1">
                {date
                    ? formatInspectionDateTime(date, undefined, displayTz, fmt)
                    : m.inspections_hub_schedule_unscheduled()}
            </p>
            {/* Labelled. An inspector's name is often just their email, and a
                bare email under a date reads as a contact on the job rather
                than the person running it — this card is the only place that
                fact appears, so it has to say what it is. */}
            <p className="text-[12px] text-ih-fg-3 mt-1 mb-4">
                {inspectorName
                    ? m.inspections_hub_schedule_inspector_named({ name: inspectorName })
                    : m.inspections_hub_schedule_inspector_none()}
            </p>
            {error && <p className="text-[12px] text-ih-bad-fg mb-2">{error}</p>}
            {canEdit && (
                <Button variant="secondary" size="sm" onClick={() => { setOpen(true); onRequestMembers?.(); }} pending={saving}>
                    {m.inspections_hub_schedule_edit()}
                </Button>
            )}

            <Modal open={open && canEdit} onClose={() => setOpen(false)} title={m.inspections_hub_schedule_edit()}>
                <form
                    id={`schedule-form-${inspectionId}`}
                    onSubmit={(e) => {
                        e.preventDefault();
                        save(e.currentTarget);
                    }}
                    className="space-y-4"
                >
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.inspections_hub_schedule_field_datetime()}
                        </span>
                        <input
                            type="datetime-local"
                            name="date"
                            lang="en"
                            defaultValue={toLocalInputValue(date)}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                            data-testid="hub-schedule-date"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.inspections_hub_schedule_field_inspector()}
                        </span>
                        <select
                            // Remounts when the list arrives, so the current inspector is
                            // selected from the real options rather than carried over.
                            key={membersReady ? "ready" : "pending"}
                            name="inspectorId"
                            defaultValue={inspectorId ?? ""}
                            disabled={!membersReady}
                            aria-describedby={membersReady ? undefined : statusId}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none disabled:opacity-60"
                            data-testid="hub-schedule-inspector"
                        >
                            <option value="">{m.inspections_hub_schedule_inspector_unassigned()}</option>
                            {membersReady
                                ? members.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.name || u.email}
                                    </option>
                                ))
                                : null}
                            {/* The current inspector stays selectable when the list lacks them
                                (a deactivated user, or the list not in yet), or saving would
                                silently unassign them. */}
                            {inspectorId && !(membersReady && members.some((u) => u.id === inspectorId)) && (
                                <option value={inspectorId}>{inspectorName ?? inspectorId}</option>
                            )}
                        </select>
                    </label>
                    <div id={statusId} role="status" aria-live="polite" className="text-[12px]" data-testid="hub-schedule-members-status">
                        {!membersReady && (membersStatus === "error" ? (
                            <span className="flex items-center gap-2">
                                <span className="text-ih-bad-fg">{m.inspections_hub_pickers_error()}</span>
                                <Button variant="secondary" size="sm" type="button" onClick={() => onRetryMembers?.()}>
                                    {m.inspections_hub_pickers_retry()}
                                </Button>
                            </span>
                        ) : (
                            <span className="text-ih-fg-3">{m.common_loading()}</span>
                        ))}
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                        <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
                            {m.common_cancel()}
                        </Button>
                        <Button variant="primary" size="sm" type="submit" pending={saving} disabled={!membersReady}>
                            {m.common_save()}
                        </Button>
                    </div>
                </form>
            </Modal>
        </Card>
    );
}
