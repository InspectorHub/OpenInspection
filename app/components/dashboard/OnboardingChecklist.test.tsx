// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { OnboardingChecklist } from "./OnboardingChecklist";
import type { OnboardingStep } from "~/lib/onboarding-progress";

/**
 * Dismissing the Getting started checklist used to be permanent: the component
 * returned null for ever and nothing anywhere else in the product mentioned
 * workspace setup, so one click hid the company name, timezone and first
 * template steps with no way back.
 *
 * What is asserted here is the way back — and that the stored dismissal is NOT
 * undone by using it.
 */
const steps = (doneIds: string[]): OnboardingStep[] =>
    ([
        { id: "company", label: "Add your company name", href: "/settings/workspace" },
        { id: "timezone", label: "Set your timezone", href: "/settings/workspace?setup=timezone" },
        { id: "first-inspection", label: "Create your first inspection", href: "#new-inspection" },
    ] as Array<Omit<OnboardingStep, "done">>).map((s) => ({ ...s, done: doneIds.includes(s.id) })) as OnboardingStep[];

function mount(props: { steps: OnboardingStep[]; dismissed: boolean; onDismiss?: () => void }) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <OnboardingChecklist
                    steps={props.steps}
                    dismissed={props.dismissed}
                    onDismiss={props.onDismiss ?? (() => {})}
                    onOpenWizard={() => {}}
                />
            ),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("OnboardingChecklist — a dismissal that can be undone", () => {
    it("shows the steps when it has not been dismissed", () => {
        mount({ steps: steps(["company"]), dismissed: false });
        expect(screen.getByText("Add your company name")).toBeTruthy();
        expect(screen.getByText("Set your timezone")).toBeTruthy();
    });

    it("collapses to a single row that still names the progress when dismissed", () => {
        mount({ steps: steps(["company"]), dismissed: true });
        // The row is there...
        expect(screen.getByText("Getting started")).toBeTruthy();
        expect(screen.getByText("1 of 3 complete")).toBeTruthy();
        // ...and the steps are not. Without both halves this would pass for a
        // component that simply ignored `dismissed`.
        expect(screen.queryByText("Set your timezone")).toBeNull();
    });

    it("reopens the steps when that row is clicked", () => {
        mount({ steps: steps([]), dismissed: true });
        expect(screen.queryByText("Set your timezone")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /Getting started/ }));

        expect(screen.getByText("Set your timezone")).toBeTruthy();
    });

    it("does not re-post the dismissal when closing what this session reopened", () => {
        const onDismiss = vi.fn();
        mount({ steps: steps([]), dismissed: true, onDismiss });

        fireEvent.click(screen.getByRole("button", { name: /Getting started/ }));
        // "Hide", not "Dismiss": the stored answer is already "put away".
        expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Hide" }));

        expect(onDismiss).not.toHaveBeenCalled();
        expect(screen.queryByText("Set your timezone")).toBeNull();
        expect(screen.getByText("Getting started")).toBeTruthy();
    });

    it("posts the dismissal the first time, from the full card", () => {
        const onDismiss = vi.fn();
        mount({ steps: steps([]), dismissed: false, onDismiss });

        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("renders nothing at all once every step is done — there is nothing to come back to", () => {
        const { container } = mount({ steps: steps(["company", "timezone", "first-inspection"]), dismissed: false });
        expect(container.textContent).not.toContain("Getting started");
    });
});
