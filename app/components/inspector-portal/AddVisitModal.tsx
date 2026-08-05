import { useState } from "react";
import { Button, Modal } from "@core/shared-ui";
import { fromLocalInputValue } from "~/lib/datetime-local";
import type { VisitTypeOption } from "./VisitsCard";
import { m } from "~/paraglide/messages";

/**
 * Choosing the next visit on a job.
 *
 * Its own file because `VisitsCard` crossed the 400-line ceiling with it
 * inline, and because it is a genuinely separate decision: the card shows what
 * has been committed to, this asks what to commit to next.
 */
export function AddVisitModal({
    open,
    visitTypes,
    suggestedTypeIds,
    submitting,
    onClose,
    onAdd,
}: {
    open: boolean;
    visitTypes: VisitTypeOption[];
    suggestedTypeIds: string[];
    submitting: boolean;
    onClose: () => void;
    onAdd: (eventTypeId: string, scheduledAt: string, durationMin: number) => void;
}) {
    const [eventTypeId, setEventTypeId] = useState("");
    const [when, setWhen] = useState("");
    const [durationMin, setDurationMin] = useState(30);

    if (!open) return null;

    const active = visitTypes.filter((t) => t.active);
    const suggested = active.filter((t) => suggestedTypeIds.includes(t.id));
    const others = active.filter((t) => !suggestedTypeIds.includes(t.id));

    // Picking a type seeds its own default duration, so the common case is no
    // typing at all — a radon pickup is not a 30-minute job because 30 happened
    // to be the control's initial value.
    const choose = (id: string) => {
        setEventTypeId(id);
        setDurationMin(active.find((t) => t.id === id)?.defaultDurationMin ?? 30);
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m.inspections_hub_visits_add_title()}
            footer={
                <>
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={!eventTypeId || !when || submitting}
                        onClick={() => onAdd(eventTypeId, fromLocalInputValue(when), durationMin)}
                    >
                        {m.inspections_hub_visits_add()}
                    </Button>
                </>
            }
        >
            {active.length === 0 ? (
                <p className="text-[13px] text-ih-fg-3">{m.inspections_hub_visits_types_empty()}</p>
            ) : (
                <div className="space-y-4">
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.inspections_hub_visits_field_type()}
                        </span>
                        <select
                            value={eventTypeId}
                            onChange={(e) => choose(e.target.value)}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                            data-testid="hub-add-visit-select"
                        >
                            <option value="">{m.inspections_hub_visits_select_type()}</option>
                            {suggested.length > 0 && (
                                <optgroup label={m.inspections_hub_visits_group_suggested()}>
                                    {suggested.map((t) => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </optgroup>
                            )}
                            {others.length > 0 && (
                                <optgroup
                                    label={
                                        suggested.length > 0
                                            ? m.inspections_hub_visits_group_other()
                                            : m.inspections_hub_visits_field_type()
                                    }
                                >
                                    {others.map((t) => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.inspections_hub_schedule_field_datetime()}
                        </span>
                        <input
                            type="datetime-local"
                            lang="en"
                            value={when}
                            onChange={(e) => setWhen(e.target.value)}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                            data-testid="hub-add-visit-when"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.settings_event_types_duration_label()}
                        </span>
                        <input
                            type="number"
                            min={1}
                            value={durationMin}
                            onChange={(e) => setDurationMin(Number(e.target.value) || 1)}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                            data-testid="hub-add-visit-duration"
                        />
                    </label>
                </div>
            )}
        </Modal>
    );
}
