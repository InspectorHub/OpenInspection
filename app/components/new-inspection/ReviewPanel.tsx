import { formatPriceCents, type WizardStepId } from "~/lib/wizard-steps";
import type { NewInspectionSummary } from "~/lib/wizard-review";
import { formatInspectionDateTime } from "~/lib/format-date";
import { m } from "~/paraglide/messages";

/**
 * What pressing Create will produce, stated while it is still being decided.
 *
 * This was the bottom half of the last step, which made it a thing you read once,
 * at the end — and its rows were plain text, so correcting a wrong template meant
 * pressing Back three times and knowing which step owned it. Here it is a column
 * beside the form for the whole flow, and every row is the way to the step that
 * decides it. The page has the width; this is what to spend it on.
 *
 * Rows with no answer are omitted rather than shown blank: People and Services
 * are legal skips, and "Client: —" reads like a field someone forgot.
 */
function ReviewRow({
    label,
    value,
    step,
    onJump,
    isCurrent,
}: {
    label: string;
    value: string;
    /** The step that owns this answer. */
    step: WizardStepId;
    onJump: (step: WizardStepId) => void;
    isCurrent: boolean;
}) {
    return (
        <button
            type="button"
            onClick={() => onJump(step)}
            aria-current={isCurrent ? "step" : undefined}
            className="w-full flex items-start justify-between gap-3 py-2 text-left group hover:bg-ih-bg-card px-2 -mx-2 rounded"
        >
            <span className="text-[12px] text-ih-fg-3 shrink-0">{label}</span>
            <span className="text-[12px] text-ih-fg-1 text-right group-hover:text-ih-primary">{value}</span>
        </button>
    );
}

export function ReviewPanel({
    summary,
    scheduledIso,
    timeZone,
    currentStep,
    onJump,
}: {
    summary: NewInspectionSummary;
    /** Null until a date is set — an unscheduled inspection has no "when" to state. */
    scheduledIso: string | null;
    timeZone: string;
    currentStep: WizardStepId;
    onJump: (step: WizardStepId) => void;
}) {
    const row = (step: WizardStepId) => ({ step, onJump, isCurrent: currentStep === step });

    return (
        <aside className="rounded-xl border border-ih-border bg-ih-bg-muted p-4 lg:sticky lg:top-4">
            <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide mb-1">
                {m.newinsp_review_heading()}
            </p>
            <div className="divide-y divide-ih-border">
                {summary.address ? (
                    <ReviewRow label={m.newinsp_review_address()} value={summary.address} {...row("property")} />
                ) : null}
                {summary.template && (
                    <ReviewRow label={m.newinsp_review_template()} value={summary.template} {...row("property")} />
                )}
                {scheduledIso && (
                    <ReviewRow
                        label={m.newinsp_review_when()}
                        value={formatInspectionDateTime(scheduledIso, undefined, timeZone)}
                        {...row("confirm")}
                    />
                )}
                {summary.client && (
                    <ReviewRow label={m.newinsp_review_client()} value={summary.client} {...row("people")} />
                )}
                {summary.agent && (
                    <ReviewRow label={m.newinsp_review_agent()} value={summary.agent} {...row("people")} />
                )}
                {summary.services && (
                    <ReviewRow
                        label={m.newinsp_review_services()}
                        value={`${summary.services.names.join(", ")} · ${formatPriceCents(summary.services.totalCents)}`}
                        {...row("services")}
                    />
                )}
                <ReviewRow
                    label={m.newinsp_review_assignee()}
                    value={summary.assignee ?? m.newinsp_review_assignee_you()}
                    {...row("confirm")}
                />
            </div>
            {/* Before anything has been entered, the panel is a heading over one
                row — say what it is for instead of looking broken. */}
            {!summary.address && !summary.template && !summary.client && !summary.services && (
                <p className="mt-2 text-[12px] text-ih-fg-4">{m.newinsp_review_empty_hint()}</p>
            )}
        </aside>
    );
}
