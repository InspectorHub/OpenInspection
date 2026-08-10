import type React from "react";
import { PageHeader } from "@core/shared-ui";
import { Breadcrumb } from "../Breadcrumb";
import type { WizardStepId } from "~/lib/wizard-steps";
import { m } from "~/paraglide/messages";

/**
 * The page around a step.
 *
 * `/inspections/new` is a route, and had been since the wizard stopped being a
 * modal — but it kept the modal's shell: a card floating in the middle of an
 * otherwise empty page, a × in its corner duplicating the Cancel button, a capped
 * height, and a body that scrolled inside the page's own scroll. That last one is
 * what clipped the typeahead lists to a sliver.
 *
 * A page instead. The form keeps a readable column width rather than stretching
 * across a desktop, and the width that is left goes to the review beside it —
 * information, not longer input rows. On a narrow screen the two stack, which puts
 * the review under the form where it was before.
 */
export function WizardLayout({
    steps,
    stepIdx,
    stepLabel,
    blockedReason,
    busy = false,
    isLastStep,
    onBack,
    onNext,
    review,
    children,
}: {
    steps: WizardStepId[];
    stepIdx: number;
    stepLabel: (step: WizardStepId) => string;
    /** Why Next is disabled, or null when it is not. */
    blockedReason: string | null;
    /**
     * A submit is in flight (portal #105). The button goes dead and spins rather
     * than sitting there looking untouched while nothing visibly happens — that
     * silence is what got clicked three times in production.
     */
    busy?: boolean;
    isLastStep: boolean;
    /** Back on any step past the first; Cancel on the first — one way out, not two. */
    onBack: () => void;
    onNext: () => void;
    review: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="w-full">
            <Breadcrumb
                items={[
                    { label: m.nav_item_inspections(), href: "/inspections" },
                    { label: m.new_inspection_title() },
                ]}
            />
            <div className="mt-1">
                <PageHeader title={m.new_inspection_title()} />
            </div>

            <div className="mt-ih-list flex flex-col lg:flex-row gap-5 items-start">
                <div className="w-full lg:flex-1 lg:max-w-[720px] min-w-0 bg-ih-bg-card rounded-xl border border-ih-border">
                    <div className="flex items-center gap-1 px-6 pt-4">
                        {steps.map((s, i) => (
                            <div key={s} className="flex items-center gap-1 flex-1">
                                <div
                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                                        i <= stepIdx ? "bg-ih-primary text-ih-fg-inverse" : "bg-ih-bg-muted text-ih-fg-4"
                                    }`}
                                >
                                    {i + 1}
                                </div>
                                <span
                                    className={`text-[11px] font-medium hidden sm:inline ${
                                        i <= stepIdx ? "text-ih-primary-text" : "text-ih-fg-4"
                                    }`}
                                >
                                    {stepLabel(s)}
                                </span>
                                {i < steps.length - 1 && (
                                    <div
                                        className={`flex-1 h-px mx-1 ${i < stepIdx ? "bg-ih-primary" : "bg-ih-bg-muted"}`}
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* No inner scroll: the page scrolls, so a portaled dropdown has
                        no overflow ancestor to be clipped by. */}
                    <div className="px-6 py-5">{children}</div>

                    <div className="flex items-center justify-between px-6 py-4 border-t border-ih-border">
                        <button
                            onClick={onBack}
                            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted"
                        >
                            {stepIdx > 0 ? m.common_back() : m.common_cancel()}
                        </button>
                        <div className="flex items-center gap-3">
                            {/* What the greyed-out button is waiting for, tied to it
                                by aria-describedby so it is not sighted-only. */}
                            {blockedReason && (
                                <p id="newinsp-blocked-reason" className="text-[12px] text-ih-fg-3">
                                    {blockedReason}
                                </p>
                            )}
                            <button
                                disabled={blockedReason !== null || busy}
                                aria-busy={busy || undefined}
                                aria-describedby={blockedReason ? "newinsp-blocked-reason" : undefined}
                                onClick={onNext}
                                className="inline-flex items-center gap-2 h-8 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {/* border-current, so it is the button's own text
                                    colour in either colour scheme — no second
                                    palette to keep in step. */}
                                {busy && (
                                    <span
                                        data-testid="wizard-next-spinner"
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
                                    />
                                )}
                                {isLastStep ? m.new_inspection_create() : m.common_next()}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="w-full lg:w-[300px] lg:shrink-0">{review}</div>
            </div>
        </div>
    );
}
