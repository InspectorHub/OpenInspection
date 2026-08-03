// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReviewPanel } from "./ReviewPanel";
import type { NewInspectionSummary } from "~/lib/wizard-review";

afterEach(cleanup);

const FULL: NewInspectionSummary = {
    address: "412 Alder Court, Springfield, IL",
    template: "Mold Inspection",
    client: "Dana Whitfield · dana@example.com",
    agent: "Ray Agent",
    services: { names: ["Full Home Inspection"], totalCents: 45000 },
    assignee: "Sam Owner",
};

const EMPTY: NewInspectionSummary = {
    address: "",
    template: null,
    client: null,
    agent: null,
    services: null,
    assignee: null,
};

function renderPanel(summary: NewInspectionSummary, onJump = vi.fn()) {
    render(
        <ReviewPanel
            summary={summary}
            scheduledIso="2026-07-25T09:00:00.000Z"
            timeZone="UTC"
            currentStep="confirm"
            onJump={onJump}
        />,
    );
    return onJump;
}

/**
 * The review was the bottom half of the last step: read once, at the end, in
 * plain text. Correcting a wrong template meant pressing Back three times and
 * knowing which step owned it. Every row is now the way to the step that decides
 * it — which is also what makes the panel worth keeping on screen throughout.
 */
describe("ReviewPanel — every row goes to the step that owns it", () => {
    it("sends the address and the template to Property", () => {
        const onJump = renderPanel(FULL);
        fireEvent.click(screen.getByText(FULL.address));
        expect(onJump).toHaveBeenCalledWith("property");
        onJump.mockClear();
        fireEvent.click(screen.getByText("Mold Inspection"));
        expect(onJump).toHaveBeenCalledWith("property");
    });

    it("sends the client and the agent to People", () => {
        const onJump = renderPanel(FULL);
        fireEvent.click(screen.getByText(/Dana Whitfield/));
        expect(onJump).toHaveBeenCalledWith("people");
        onJump.mockClear();
        fireEvent.click(screen.getByText("Ray Agent"));
        expect(onJump).toHaveBeenCalledWith("people");
    });

    it("sends the services line to Services", () => {
        const onJump = renderPanel(FULL);
        fireEvent.click(screen.getByText(/Full Home Inspection/));
        expect(onJump).toHaveBeenCalledWith("services");
    });

    it("sends the schedule and the assignee to Confirm", () => {
        const onJump = renderPanel(FULL);
        fireEvent.click(screen.getByText("Sam Owner"));
        expect(onJump).toHaveBeenCalledWith("confirm");
    });
});

describe("ReviewPanel — what it says when it has nothing to say", () => {
    it("omits rows with no answer rather than showing them blank", () => {
        renderPanel(EMPTY);
        // People and Services are legal skips; "Client: —" reads like a field
        // someone forgot to fill.
        expect(screen.queryByText(/client/i)).toBeNull();
        expect(screen.queryByText(/agent/i)).toBeNull();
    });

    it("says it will fill in, instead of looking broken", () => {
        renderPanel(EMPTY);
        expect(screen.getByText(/fills in as you go/i)).toBeTruthy();
    });

    it("names the viewer as the inspector when nothing else is known", () => {
        renderPanel(EMPTY);
        expect(screen.getByText("You")).toBeTruthy();
    });
});
