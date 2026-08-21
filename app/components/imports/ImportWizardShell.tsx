import type { ReactNode } from "react";
import { Button } from "@core/shared-ui";

import { m } from "~/paraglide/messages";
import type { ImportStepId } from "~/lib/import-wizard-steps";

/**
 * The frame around an import run's steps.
 *
 * A shell of its own rather than the booking wizard's, whose `steps` parameter
 * is that flow's own literal union rather than a type parameter. Widening it
 * would edit a component already in use elsewhere for the benefit of this one.
 *
 * The two rules this frame obeys are NOT implemented here: which steps exist
 * and why the next control is disabled both come in as values, worked out by
 * pure functions that can be asserted. A frame that decided either would be a
 * second implementation of a rule the product already has.
 *
 * The steps are NUMBERED, unlike the entry points on the list page, and the
 * difference is the whole point of each device: the entries are three different
 * things you might be bringing over, in no order, while these are one ordered
 * path through one run. The number is the step's position IN THIS RUN — a run
 * with no columns to map counts 1, 2, 3 — so it says how much is left rather
 * than which slot of a fixed four this is.
 */
export function ImportWizardShell({
    steps,
    current,
    stepLabel,
    blockedReason,
    busy,
    onStep,
    children,
}: {
    steps: ImportStepId[];
    current: ImportStepId;
    stepLabel: (step: ImportStepId) => string;
    /** Why moving on is unavailable, or null. Rendered verbatim beside the control. */
    blockedReason: string | null;
    busy: boolean;
    onStep: (step: ImportStepId) => void;
    children: ReactNode;
}) {
    // Positions rather than the steps themselves: `steps` is not typed as
    // sparse, so an out-of-range read is `undefined` at runtime and
    // `ImportStepId` to the compiler — a guard the compiler believes is
    // unnecessary and the browser needs.
    const index = steps.indexOf(current);
    const backIndex = index - 1;
    const nextIndex = index + 1;

    return (
        <div className="space-y-4">
            <ol
                aria-label={m.imports_wizard_steps_aria()}
                className="flex flex-wrap items-center gap-2"
            >
                {steps.map((step, i) => (
                    <li key={step}>
                        <Button
                            data-testid={`import-step-${step}`}
                            variant={step === current ? "primary" : "secondary"}
                            aria-current={step === current ? "step" : undefined}
                            onClick={() => onStep(step)}
                        >
                            {/* Lighter than the label it precedes, so the rail
                                reads as names with positions rather than as a
                                row of numbers. Weight rather than colour: a
                                muted foreground on a filled button is the one
                                pair in this system that fails contrast. */}
                            <span className="font-normal tabular-nums">{i + 1}</span>
                            {stepLabel(step)}
                        </Button>
                    </li>
                ))}
            </ol>

            {children}

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    data-testid="import-step-back"
                    variant="secondary"
                    disabled={backIndex < 0 || busy}
                    onClick={() => onStep(steps[backIndex])}
                >
                    {m.common_back()}
                </Button>
                <Button
                    data-testid="import-step-next"
                    variant="primary"
                    disabled={nextIndex >= steps.length || blockedReason !== null || busy}
                    onClick={() => onStep(steps[nextIndex])}
                >
                    {m.common_next()}
                </Button>
                {/* Rendered only when it has something to say. An always-present
                    line reading "" is a layout jump, and one reading "Ready" is
                    a second thing to keep true. */}
                {blockedReason && (
                    <p data-testid="import-step-blocked" className="text-[12px] text-ih-fg-2">
                        {blockedReason}
                    </p>
                )}
            </div>
        </div>
    );
}
