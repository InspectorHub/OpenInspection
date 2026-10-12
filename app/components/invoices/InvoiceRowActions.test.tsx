// @vitest-environment happy-dom
/**
 * Void is the trigger of a confirm dialog that closes in the same batch the busy flag flips.
 * A natively disabled trigger would drop focus to <body>, so while busy it must be
 * aria-disabled (still focusable, inert) and never carry the `disabled` attribute.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { InvoiceRowActions } from "./InvoiceRowActions";
import { m } from "~/paraglide/messages";

afterEach(cleanup);

function renderPaid(busy: boolean, onVoid = vi.fn()) {
    const view = render(
        <MemoryRouter>
            <InvoiceRowActions
                invoice={{ id: "inv-1", status: "paid", inspectionId: null } as never}
                busy={busy}
                pickerOpen={false}
                onOpenPicker={vi.fn()}
                onCancelPicker={vi.fn()}
                onOpenPayments={vi.fn()}
                onMarkPaid={vi.fn()}
                onVoid={onVoid}
            />
        </MemoryRouter>,
    );
    return { ...view, onVoid, btn: view.getByText(m.invoices_action_void()) as HTMLButtonElement };
}

describe("InvoiceRowActions Void", () => {
    it("is aria-disabled, not natively disabled, and inert while busy", () => {
        const { btn, onVoid } = renderPaid(true);
        expect(btn.getAttribute("aria-disabled")).toBe("true");
        expect(btn.hasAttribute("disabled")).toBe(false);
        fireEvent.click(btn);
        expect(onVoid).not.toHaveBeenCalled();
    });

    it("fires the handler when idle", () => {
        const { btn, onVoid } = renderPaid(false);
        expect(btn.hasAttribute("aria-disabled")).toBe(false);
        fireEvent.click(btn);
        expect(onVoid).toHaveBeenCalledTimes(1);
    });
});
