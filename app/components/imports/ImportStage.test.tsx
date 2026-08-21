// @vitest-environment happy-dom
/**
 * The last screen, and the one rule about its button.
 *
 * A disabled Import says WHY, in the SERVER's sentence — the same computation
 * the counts came from, so a banner and a button can never disagree about
 * whether the run is ready. Deriving it again here is how they would.
 *
 * The counts are printed side by side and they add up. A screen that showed only
 * the problems could not tell "nothing is wrong" from "nothing was examined".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { ImportStage } from "./ImportStage";

afterEach(cleanup);

type Props = React.ComponentProps<typeof ImportStage>;

function renderStage(over: Partial<Props> = {}) {
    const onApply = vi.fn();
    const onRevert = vi.fn();
    render(
        <ImportStage
            counts={{ total: 10, ok: 7, conflicts: 3, problems: 0 }}
            blockedReason={null}
            status="staged"
            undoUntil={null}
            busy={false}
            onApply={onApply}
            onRevert={onRevert}
            {...over}
        />,
    );
    return { onApply, onRevert };
}

function importButton() {
    return screen.getByRole<HTMLButtonElement>("button", { name: "Import" });
}

describe("ImportStage: what this run will do", () => {
    it("prints all four numbers, not just the bad one", () => {
        renderStage();
        expect(screen.getByText("10 entries")).toBeTruthy();
        expect(screen.getByText("7 ready")).toBeTruthy();
        expect(screen.getByText("3 already exist")).toBeTruthy();
        expect(screen.getByText("0 need fixing")).toBeTruthy();
    });
});

describe("ImportStage: entries that already exist", () => {
    it("asks how the clashes should be settled when there are any", () => {
        renderStage();
        expect(screen.getByRole("radiogroup", { name: "Entries that already exist" })).toBeTruthy();
    });

    it("does not ask when there are none, rather than asking and disabling", () => {
        renderStage({ counts: { total: 10, ok: 10, conflicts: 0, problems: 0 } });
        expect(screen.queryByRole("radiogroup")).toBeNull();
    });

    it("sends the answer that was chosen, not the one it opened on", () => {
        const { onApply } = renderStage();
        fireEvent.click(screen.getByRole("radio", { name: "Replace with the imported version" }));
        fireEvent.click(importButton());
        expect(onApply).toHaveBeenCalledWith("overwrite");
    });

    it("sends the default when nothing was touched, which is the control above", () => {
        const { onApply } = renderStage();
        fireEvent.click(importButton());
        expect(onApply).toHaveBeenCalledWith("skip");
    });
});

describe("ImportStage: a button that cannot be pressed says why", () => {
    it("prints the server's sentence and disables the button", () => {
        renderStage({
            counts: { total: 10, ok: 5, conflicts: 0, problems: 5 },
            blockedReason: "5 entries cannot be imported as written. Fix them below.",
        });
        expect(screen.getByText("5 entries cannot be imported as written. Fix them below.")).toBeTruthy();
        expect(importButton().disabled).toBe(true);
    });

    it("invents no reason of its own from the same counts", () => {
        // The counts alone would let this screen conclude "5 problems" and write
        // its own sentence. It does not: one computation, one sentence. Whether
        // a run may go ahead also depends on the seat position, which is not on
        // this screen at all.
        renderStage({ counts: { total: 10, ok: 5, conflicts: 0, problems: 5 }, blockedReason: null });
        expect(importButton().disabled).toBe(false);
    });
});

describe("ImportStage: after the run has been applied", () => {
    it("offers the undo, with the date it stops working", () => {
        renderStage({ status: "applied", undoUntil: "Sep 17, 2026" });
        expect(screen.getByText("Available until Sep 17, 2026.")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
        expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    });

    it("offers it for a run that landed only in part, which is still a run to take back", () => {
        renderStage({ status: "partially_applied", undoUntil: "Sep 17, 2026" });
        expect(screen.getByRole("button", { name: "Undo this import" })).toBeTruthy();
    });

    it("says why the undo is gone rather than removing it without explanation", () => {
        renderStage({ status: "applied", undoUntil: null });
        expect(screen.queryByRole("button", { name: "Undo this import" })).toBeNull();
        expect(screen.getByText(/no longer available/i)).toBeTruthy();
    });

    it("hands the press to its caller rather than acting on it", () => {
        // The confirmation belongs to the page: an undo deletes real rows, and
        // this repository does not use `window.confirm`.
        const { onRevert } = renderStage({ status: "applied", undoUntil: "Sep 17, 2026" });
        fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
        expect(onRevert).toHaveBeenCalledTimes(1);
    });
});

describe("ImportStage: a run that is neither ready nor applied", () => {
    it("offers no Import button for a run that has already been undone", () => {
        // `applied` is not the only state that is past this button. A run whose
        // rows were taken back still has counts worth reading, and an Import
        // button on it posts to an endpoint that answers 409.
        renderStage({ status: "reverted", undoUntil: "Sep 17, 2026" });
        expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Undo this import" })).toBeNull();
        expect(screen.getByText("10 entries")).toBeTruthy();
    });

    it("offers it for a staged run, which is the control on the line above", () => {
        renderStage();
        expect(importButton()).toBeTruthy();
    });

    it("offers neither while a run is in the middle of being applied", () => {
        renderStage({ status: "applying" });
        expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Undo this import" })).toBeNull();
    });
});

describe("ImportStage: while a submit is in flight", () => {
    it("disables the button it would be pressed twice through", () => {
        renderStage({ busy: true });
        expect(importButton().disabled).toBe(true);
    });
});
