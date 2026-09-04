// @vitest-environment happy-dom
/**
 * The editor must open showing the code it was given.
 *
 * Found by opening the dialog, not by reading it: a `fixed` code worth $50
 * opened as "Percent off" with an EMPTY amount, and saving that would have
 * converted a $50 discount into a 0% one. The route-level specs could not see
 * it — they assert what a submitted form sends, and this is a fault in what the
 * form is initialised WITH.
 *
 * The cause is a React rule rather than a typo: the component derives `type`
 * from `discount` in a `useState` INITIALISER, and an initialiser runs once per
 * mount. The modal is rendered unconditionally with `discount: null`, so that
 * one run saw null and the state stayed on "percent" for every row opened
 * afterwards. The call site keys the modal per row to force a fresh mount.
 *
 * So the assertions here are about the FIRST paint for a given discount, which
 * is precisely what the key protects.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiscountEditorModal, type EditableDiscount } from "./DiscountEditorModal";

const FIXED: EditableDiscount = {
    id: "d1", code: "SPRING50", type: "fixed", value: 5000, active: true,
    maxUses: null, expiresAt: null,
};
const PERCENT: EditableDiscount = {
    id: "d2", code: "TEN", type: "percent", value: 10, active: false,
    maxUses: 25, expiresAt: null,
};

/** Mounted the way the panel mounts it: keyed, so each row is a fresh instance. */
function open(discount: EditableDiscount) {
    return render(
        <DiscountEditorModal
            key={discount.id}
            discount={discount}
            busy={false}
            onClose={vi.fn()}
            onSubmit={vi.fn()}
        />,
    );
}

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;

describe("the discount editor opens on the row it was given", () => {
    it("CONTROL — a percent code opens as percent, so the fixed case below is not vacuous", () => {
        open(PERCENT);
        expect((field("type") as HTMLSelectElement).value).toBe("percent");
        expect((field("value") as HTMLInputElement).value).toBe("10");
    });

    it("a FIXED code opens as fixed — not as the component's default", () => {
        open(FIXED);
        expect((field("type") as HTMLSelectElement).value).toBe("fixed");
    });

    it("and shows its amount in DOLLARS, because that is what the label promises", () => {
        // 5000 cents. Showing "5000" here would invite someone to correct it
        // down to 50 and cut the discount by a hundredfold; showing "" would
        // save a zero.
        open(FIXED);
        expect((field("value") as HTMLInputElement).value).toBe("50.00");
    });

    it("labels the amount field by type rather than generically", () => {
        open(FIXED);
        expect(screen.getByText(/Amount in dollars/i)).toBeTruthy();
        expect(screen.queryByText(/Percent \(whole number\)/i)).toBeNull();
    });

    it("carries the row's other fields — active, code, and a blank limit", () => {
        open(PERCENT);
        expect((field("code") as HTMLInputElement).value).toBe("TEN");
        expect((field("maxUses") as HTMLInputElement).value).toBe("25");
        expect((field("active") as HTMLInputElement).checked).toBe(false);
    });

    it("an ACTIVE code opens with the box ticked", () => {
        open(FIXED);
        expect((field("active") as HTMLInputElement).checked).toBe(true);
    });

    it("NEGATIVE CONTROL — no discount renders no form at all", () => {
        render(<DiscountEditorModal discount={null} busy={false} onClose={vi.fn()} onSubmit={vi.fn()} />);
        expect(document.querySelector('[name="code"]')).toBeNull();
    });
});
