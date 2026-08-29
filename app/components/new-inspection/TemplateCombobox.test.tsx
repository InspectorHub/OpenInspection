// @vitest-environment happy-dom
/**
 * The template picker, and what it does with a template nobody may start on any
 * more.
 *
 * The rule under test is not "hide it". A thing that vanishes without a reason
 * is more unsettling than one that leaves with a reason: the inspector's first
 * conclusion is that their permissions changed or that the product broke. So the
 * row stays, disabled, and says which of the two things happened -- and the two
 * differ in what anybody can do about it.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateCombobox } from "./TemplateCombobox";

const RETIRED_AT = Date.UTC(2026, 2, 15);

function open(templates: Parameters<typeof TemplateCombobox>[0]["templates"]) {
    const setTemplateId = vi.fn();
    render(
        <TemplateCombobox
            id="tpl"
            templates={templates}
            templateId=""
            setTemplateId={setTemplateId}
        />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    return { setTemplateId };
}

describe("TemplateCombobox", () => {
    it("lists a superseded statutory template, disabled, with its reason", () => {
        open([
            { id: "a", name: "TREC REI 7-6", retiredAt: RETIRED_AT, retiredReason: "superseded" },
            { id: "b", name: "TREC REI 7-7", retiredAt: null, retiredReason: null },
        ]);

        const old = screen.getByRole("option", { name: /7-6/ });
        // `aria-disabled` rather than the `disabled` attribute: this is a
        // listbox option, not a form control, and a disabled option still has
        // to be reachable so a screen-reader user hears the reason too.
        expect(old).toHaveAttribute("aria-disabled", "true");
        expect(old).toHaveTextContent(/replaced/i);
        expect(old).toHaveTextContent("2026-03-15");

        // The positive control. A picker that disabled everything would satisfy
        // the assertions above and would offer no template at all.
        const live = screen.getByRole("option", { name: /7-7/ });
        expect(live).not.toHaveAttribute("aria-disabled", "true");
    });

    it("gives an uninstalled template different words, because the way back differs", () => {
        open([
            { id: "a", name: "TREC REI 7-6", retiredAt: RETIRED_AT, retiredReason: "uninstalled" },
        ]);
        const old = screen.getByRole("option", { name: /7-6/ });
        // Superseded is nothing to do about; uninstalled is something an
        // administrator can undo, and one word for both would say neither.
        expect(old).toHaveTextContent(/reinstall/i);
    });

    it("refuses to select a retired template even when it is clicked", () => {
        const { setTemplateId } = open([
            { id: "a", name: "TREC REI 7-6", retiredAt: RETIRED_AT, retiredReason: "superseded" },
        ]);
        // Listing it must not make it choosable. `aria-disabled` is a message to
        // a reader; this is the part that holds.
        fireEvent.mouseDown(screen.getByRole("option", { name: /7-6/ }));
        expect(setTemplateId).not.toHaveBeenCalled();
    });
});
