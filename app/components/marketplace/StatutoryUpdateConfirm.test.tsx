// @vitest-environment happy-dom
/**
 * The confirmation an administrator reads before updating a statutory package.
 *
 * Its job is to state the cost in numbers, not to warn. Updating retires the
 * workspace's current template, and inspections already under way stay on the
 * retired one -- which for most of them is fine, because their dates fall inside
 * the superseded revision's window and their form goes out exactly as it would
 * have. A dialog that said only "this affects work in progress" would talk an
 * administrator out of an update they should make.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatutoryUpdateConfirm } from "./StatutoryUpdateConfirm";

const base = {
    open: true,
    name: "TREC REI",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    submitting: false,
};

describe("StatutoryUpdateConfirm", () => {
    it("reports both numbers: what keeps producing and what cannot", () => {
        render(
            <StatutoryUpdateConfirm
                {...base}
                impact={{ total: 15, producible: 12, blocked: 3, fromRevision: "7-6", toRevision: "7-7" }}
            />,
        );
        const dialog = screen.getByRole("dialog");
        // The reassuring half. Twelve inspections are unaffected and the dialog
        // has to say so, or the number that follows reads as the whole story.
        expect(dialog).toHaveTextContent("12");
        expect(dialog).toHaveTextContent("7-6");
        // The cost half, before the button rather than after it.
        expect(dialog).toHaveTextContent("3");
        expect(dialog).toHaveTextContent("7-7");
    });

    it("says plainly when nothing in progress is blocked, instead of staying quiet", () => {
        render(
            <StatutoryUpdateConfirm
                {...base}
                impact={{ total: 12, producible: 12, blocked: 0, fromRevision: "7-6", toRevision: "7-7" }}
            />,
        );
        // Silence here would leave the reader to assume the worst about an
        // update that costs them nothing. Unnecessary alarm is as much a defect
        // as a missed warning.
        expect(screen.getByRole("dialog")).toHaveTextContent(/none of them/i);
    });

    it("is a dialog with its own controls, never a browser confirm", () => {
        // happy-dom ships no `window.confirm`, so it is planted here: the
        // assertion is that this component asks the browser for nothing.
        const confirmSpy = vi.fn();
        (window as unknown as { confirm: unknown }).confirm = confirmSpy;
        render(
            <StatutoryUpdateConfirm
                {...base}
                impact={{ total: 0, producible: 0, blocked: 0, fromRevision: "7-6", toRevision: "7-7" }}
            />,
        );
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("shows nothing but a wait while the counts are still being read", () => {
        // The counts are the whole content. Rendering the button beside a blank
        // space would invite a decision made on no information at all.
        render(<StatutoryUpdateConfirm {...base} impact={null} />);
        expect(screen.getByRole("dialog")).toHaveTextContent(/counting/i);
        expect(screen.queryByRole("button", { name: /update the template/i })).toBeNull();
    });
});
