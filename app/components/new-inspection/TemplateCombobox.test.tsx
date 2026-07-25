import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TemplateCombobox } from "./TemplateCombobox";

afterEach(cleanup);

const TEMPLATES = [
    { id: "t1", name: "Standard Residential", itemCount: 120 },
    { id: "t2", name: "Radon Measurement Report", itemCount: 20 },
    { id: "t3", name: "Sewer Scope", itemCount: 9 },
];

function open(templateId = "") {
    const setTemplateId = () => {};
    // A scrolling panel around the control — the wizard's body, which is what
    // clipped the list. Rendering it here means the test fails again if the list
    // ever goes back to being a child of it.
    render(
        <div data-testid="panel" style={{ overflowY: "auto", height: 200 }}>
            <TemplateCombobox id="tpl" templates={TEMPLATES} templateId={templateId} setTemplateId={setTemplateId} />
        </div>,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    return screen.getByRole("listbox");
}

/**
 * The list used to be `absolute` inside the wizard body, which is
 * `overflow-y-auto`. Measured at a 1260x615 viewport: 16px of a 224px list
 * visible, with all 20 templates below the cut. It renders in a portal now, so
 * these two assertions are the ones that matter — anything else about the list is
 * cosmetic next to "can the inspector see it".
 */
describe("TemplateCombobox — the list escapes the panel that scrolls", () => {
    it("renders outside the scrolling panel, not inside it", () => {
        const list = open();
        expect(screen.getByTestId("panel").contains(list)).toBe(false);
        expect(document.body.contains(list)).toBe(true);
    });

    it("is positioned against the viewport, so no ancestor can clip it", () => {
        expect(open().style.position).toBe("fixed");
    });

    it("caps its own height instead of running off the bottom of the screen", () => {
        expect(open().style.maxHeight).toBeTruthy();
    });
});

describe("TemplateCombobox — picking is still the only thing that selects", () => {
    it("lists every template when nothing has been typed", () => {
        open();
        expect(screen.getAllByRole("option")).toHaveLength(3);
    });

    it("filters on what was typed", () => {
        open();
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "radon" } });
        const options = screen.getAllByRole("option");
        expect(options).toHaveLength(1);
        expect(options[0].textContent).toContain("Radon Measurement Report");
    });

    it("selects nothing by typing, even down to a single match", () => {
        let selected = "";
        render(
            <TemplateCombobox
                id="tpl2"
                templates={TEMPLATES}
                templateId=""
                setTemplateId={(v) => {
                    selected = v;
                }}
            />,
        );
        const input = screen.getAllByRole("combobox")[0];
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "sewer" } });
        expect(selected).toBe("");
    });
});
