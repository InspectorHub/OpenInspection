// @vitest-environment happy-dom
/**
 * Which product this export came from — the first question of the whole flow.
 *
 * Two failures live on this screen and neither is visible from a screenshot:
 *
 *  1. **Not knowing which file to send.** It is the earliest and quietest
 *     failure in the import flow — a person exports the wrong thing, uploads
 *     it, and is told nothing here can read it. The answer is one sentence per
 *     product and it belongs on the picker, not in a help centre.
 *  2. **Not knowing what "we cannot read it" costs.** A vendor with no reader
 *     goes to a person, and that path is measured in working days rather than
 *     in seconds. Saying so at the picker beats saying it after the operator
 *     has handed over a file he needed this week.
 *
 * So the assertions below COMPARE two products that differ in exactly that
 * property, rather than checking that a row rendered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { SourcePicker } from "./SourcePicker";

afterEach(cleanup);

function renderPicker(over: {
    intent?: "templates.create" | "contacts.import" | "members.invite" | "assisted.full";
    value?: string | null;
    hasAssistedMigration?: boolean;
} = {}) {
    const onPick = vi.fn();
    render(
        <SourcePicker
            intent={over.intent ?? "templates.create"}
            value={over.value ?? null}
            hasAssistedMigration={over.hasAssistedMigration ?? true}
            onPick={onPick}
        />,
    );
    return { onPick };
}

describe("SourcePicker: which file to send", () => {
    it("names the file and where it lives, per product", () => {
        renderPicker();
        expect(screen.getByText(/\.tpz/)).toBeTruthy();
        expect(screen.getByText(/Data folder/i)).toBeTruthy();
        expect(screen.getByText(/\.HGF/)).toBeTruthy();
    });

    it("gives each product a DIFFERENT answer", () => {
        // The control for the case above. One sentence repeated under three
        // headings would satisfy every "the text is on the page" assertion
        // while telling nobody which file to export.
        renderPicker();
        const said = screen
            .getAllByRole("radio")
            .map((r) => r.closest("label")?.textContent ?? "");
        expect(said.length).toBe(3);
        expect(new Set(said).size).toBe(3);
    });
});

describe("SourcePicker: how long it takes", () => {
    it("is HONEST about the path for a vendor nothing here reads", () => {
        // The competitive gap this copy refuses to hide: this vendor's
        // templates import automatically elsewhere in minutes, and here they go
        // to a person with a ten-working-day commitment.
        renderPicker();
        const homegauge = screen.getByRole("radio", { name: /HomeGauge/i }).closest("label");
        expect(homegauge?.textContent).toMatch(/working days/i);
    });

    it("offers the PDF route WITHOUT dropping the commitment it sits beside", () => {
        // 🔴 Both sentences, and this asserts both — because the failure mode is
        // that the faster option quietly replaces the disclosure rather than
        // joining it. An earlier attempt at this did exactly that, and the
        // "working days" test above is what caught it.
        //
        // It also has to be here at all: the panel below this picker now offers
        // the PDF route, and before this line the selected card told the
        // operator to export a spreadsheet while the panel underneath asked for
        // a printed PDF. Both were on one screen and every unit test passed.
        renderPicker();
        const homegauge = screen.getByRole("radio", { name: /HomeGauge/i }).closest("label");
        expect(homegauge?.textContent).toMatch(/working days/i);
        expect(homegauge?.textContent).toMatch(/print a blank template to PDF/i);
    });

    it("POSITIVE CONTROL — a product with a reader does NOT show that timescale", () => {
        renderPicker();
        const spectora = screen.getByRole("radio", { name: /Spectora/i }).closest("label");
        expect(spectora?.textContent).not.toMatch(/working days/i);
        // And it does say what happens instead, so the absence above is a
        // different sentence rather than a missing one.
        expect(spectora?.textContent).toMatch(/stay on this page/i);
    });

    it("STATES A DURATION for a product with a reader — spec §3.2b requires one on every path", () => {
        // This assertion could not be written until 2026-08-25, and the reason
        // is the point of it. §3.2b asks every source path to say how long it
        // takes; the assisted path has said "2 working days / back within 10"
        // all along, and the readable path said only "stay on this page" —
        // true, and not an answer to the question. The gap was deliberate:
        // nobody had timed a real conversion in workerd, and an invented
        // duration is worse than none.
        //
        // It has now been timed. tests/fixtures/intake/manifest.json carries
        // the numbers against the file hashes they were measured on: 43 ms
        // median for the 1873-row spreadsheet, 9 ms for the 357-item template
        // archive, in real workerd, with a linear scaling curve behind them.
        // So the sentence can carry a scale honestly.
        //
        // Matching the SCALE and not a number: the copy must not harden into a
        // figure, because the wait a person actually experiences is dominated
        // by their upload, not by the 43 ms at the far end.
        renderPicker();
        const spectora = screen.getByRole("radio", { name: /Spectora/i }).closest("label");
        expect(spectora?.textContent).toMatch(/seconds/i);
        // NOT the "you can leave this page" escape hatch §3.2b attaches to a
        // path over a few seconds. Asserting its ABSENCE is what stops the two
        // sentences being pasted together: this path holds the request open,
        // so an invitation to leave would lose the operator their import.
        expect(spectora?.textContent).not.toMatch(/leave this page/i);
    });

    it("does not promise a person where this deployment has none", () => {
        // Self-hosted has no support path, and there the upload is refused
        // before anything is stored. Offering the assisted timescale would be
        // a door onto a wall.
        renderPicker({ hasAssistedMigration: false });
        const homegauge = screen.getByRole("radio", { name: /HomeGauge/i }).closest("label");
        expect(homegauge?.textContent).not.toMatch(/working days/i);
        expect(homegauge?.textContent).toMatch(/nothing here reads/i);
    });
});

describe("SourcePicker: what it hands back", () => {
    it("reports the picked vendor to its caller", () => {
        const { onPick } = renderPicker();
        fireEvent.click(screen.getByRole("radio", { name: /Home Inspector Pro/i }));
        expect(onPick).toHaveBeenCalledWith("home_inspector_pro");
    });

    it("carries the declaration in the form field the server reads", () => {
        // A native form submission, so the radio's own name IS the wire. A
        // picker whose value never reaches the request is the deleted rule
        // wearing a picker: the server would fall back to guessing.
        renderPicker({ value: "spectora" });
        const chosen = screen.getByRole<HTMLInputElement>("radio", { name: /Spectora/i });
        expect(chosen.getAttribute("name")).toBe("vendor");
        expect(chosen.value).toBe("spectora");
        expect(chosen.checked).toBe(true);
    });

    it("starts with nothing chosen where there is a real choice", () => {
        renderPicker();
        expect(screen.getAllByRole<HTMLInputElement>("radio").some((r) => r.checked)).toBe(false);
    });
});

describe("SourcePicker: entries that have no question to ask", () => {
    it("renders nothing for the entry that offers one source", () => {
        // A radio group of one is not a question. The entry point already
        // settled it, and the panel around this component says so instead.
        renderPicker({ intent: "contacts.import", value: "csv_generic" });
        expect(screen.queryByRole("radiogroup")).toBeNull();
    });

    it("renders nothing for the entry whose owner could not name the product", () => {
        renderPicker({ intent: "assisted.full" });
        expect(screen.queryByRole("radiogroup")).toBeNull();
    });

    it("POSITIVE CONTROL — it does render for the entry that has a choice", () => {
        renderPicker({ intent: "templates.create" });
        expect(screen.queryByRole("radiogroup")).toBeTruthy();
    });
});
