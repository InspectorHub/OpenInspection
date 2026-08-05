// @vitest-environment happy-dom
/**
 * The in-flight affordance (portal #105).
 *
 * The guard in `useGuardedSubmit` stops the second click from reaching the
 * server, but on its own it makes the button LOOK broken: the inspector clicks
 * Create, nothing about the page changes, and clicking again is the reasonable
 * next thing to do. Disabling the button and spinning it is the half that tells
 * them why the page went quiet.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { WizardLayout } from "./WizardLayout";

afterEach(cleanup);

function renderLayout(props: { busy?: boolean; blockedReason?: string | null }) {
    return render(
        <WizardLayout
            steps={["property", "confirm"]}
            stepIdx={1}
            stepLabel={(s) => s}
            blockedReason={props.blockedReason ?? null}
            busy={props.busy}
            isLastStep
            onBack={vi.fn()}
            onNext={vi.fn()}
            review={<div>review</div>}
        >
            <div>body</div>
        </WizardLayout>,
    );
}

const createButton = (c: HTMLElement) =>
    ([...c.querySelectorAll("button")] as HTMLButtonElement[]).at(-1)!;

describe("WizardLayout — submit-in-flight", () => {
    it("leaves the submit button live and quiet when nothing is in flight", () => {
        const { container } = renderLayout({});
        const btn = createButton(container);
        expect(btn.hasAttribute("disabled")).toBe(false);
        expect(btn.getAttribute("aria-busy")).toBeNull();
        expect(container.querySelector('[data-testid="wizard-next-spinner"]')).toBeNull();
    });

    it("disables the submit button and spins it while a submit is in flight", () => {
        const { container } = renderLayout({ busy: true });
        const btn = createButton(container);
        expect(btn.hasAttribute("disabled")).toBe(true);
        expect(btn.getAttribute("aria-busy")).toBe("true");
        expect(container.querySelector('[data-testid="wizard-next-spinner"]')).toBeTruthy();
    });
});
