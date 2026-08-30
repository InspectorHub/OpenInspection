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
                impact={{ total: 15, producible: 12, blocked: 3, fromRevision: "7-6", toRevision: "7-7", fromWithdrawal: null }}
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
                impact={{ total: 12, producible: 12, blocked: 0, fromRevision: "7-6", toRevision: "7-7", fromWithdrawal: null }}
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
                impact={{ total: 0, producible: 0, blocked: 0, fromRevision: "7-6", toRevision: "7-7", fromWithdrawal: null }}
            />,
        );
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("a withdrawn 'from' revision says WHY, and the two reasons differ", () => {
        // The two-number copy is FALSE here -- nothing produces from a withdrawn
        // revision -- so this case has its own body. What it must not do is say
        // only "withdrawn": a wrong field map leaves documents to reissue once a
        // corrected map ships, while an authority's withdrawal leaves none, and
        // an administrator reading one sentence for both learns neither.
        const impact = {
            total: 4, producible: 0, blocked: 4, fromRevision: "7-6", toRevision: "7-7",
        };
        const { unmount } = render(
            <StatutoryUpdateConfirm
                {...base}
                impact={{ ...impact, fromWithdrawal: { at: Date.UTC(2026, 3, 1), reason: "field_map_incorrect" } }}
            />,
        );
        const ours = screen.getByRole("dialog").textContent ?? "";
        unmount();

        render(
            <StatutoryUpdateConfirm
                {...base}
                impact={{ ...impact, fromWithdrawal: { at: Date.UTC(2026, 3, 1), reason: "authority_withdrew" } }}
            />,
        );
        const theirs = screen.getByRole("dialog").textContent ?? "";

        // Neither may carry the reassuring count -- "N of them stay on revision
        // 7-6 and still produce their form" -- because none of them does.
        for (const text of [ours, theirs]) {
            expect(text).not.toMatch(/stays? on revision/i);
            expect(text).not.toMatch(/none of them/i);
        }
        // Both name the revision and the count, so the branch is not simply
        // rendering less.
        for (const text of [ours, theirs]) {
            expect(text).toContain("7-6");
            expect(text).toContain("4");
        }
        // And they are genuinely two messages. Comparing them to each other
        // rather than to a literal chosen here: a copy edit may change every
        // word, and the property under test is that these two never converge.
        expect(ours).not.toBe(theirs);
        // The one distinguishing instruction, stated rather than implied.
        expect(ours).toMatch(/produced again/i);
        expect(theirs).not.toMatch(/produced again/i);
    });

    it("shows nothing but a wait while the counts are still being read", () => {
        // The counts are the whole content. Rendering the button beside a blank
        // space would invite a decision made on no information at all.
        render(<StatutoryUpdateConfirm {...base} impact={null} />);
        expect(screen.getByRole("dialog")).toHaveTextContent(/counting/i);
        expect(screen.queryByRole("button", { name: /update the template/i })).toBeNull();
    });
});
