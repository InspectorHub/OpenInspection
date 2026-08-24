// @vitest-environment happy-dom
/**
 * What actually came through.
 *
 * ── The failure this screen exists for ──────────────────────────────────────
 * The import step's four numbers add up and still cannot tell a good
 * conversion from a useless one. A template whose seventy-six items all became
 * plain text boxes reports the same total, the same "ready" count and the same
 * zero problems as one that converted perfectly — and the operator finds out
 * weeks later, on a job, when there is nothing to rate.
 *
 * So every assertion below is about what the screen LEADS with. "A tree
 * renders" is true of a screen that buries the disaster under seventy-six
 * item names, which is exactly what the count table already does.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { PreviewStage } from "./PreviewStage";
import type { BatchStructure } from "~/lib/imports-types";

afterEach(cleanup);

function items(n: number, landedAs: "rated" | "choices" | "plain") {
    return Array.from({ length: n }, (_, i) => ({ label: `Item ${i + 1}`, landedAs }));
}

function structure(over: Partial<BatchStructure> = {}): BatchStructure {
    return {
        name: "Whole House Checklist",
        sections: [{ title: "Roof", items: items(3, "rated") }],
        dropped: [],
        warnings: [],
        ...over,
    };
}

function anomalies(): string {
    return screen.getByTestId("preview-anomalies").textContent ?? "";
}

describe("PreviewStage: it leads with what went wrong", () => {
    it("names how many items came through weaker than the rest", () => {
        render(<PreviewStage structure={structure({
            sections: [
                { title: "Roof", items: items(12, "plain") },
                { title: "Interior", items: items(30, "rated") },
            ],
        })} />);
        expect(anomalies()).toMatch(/12 items/);
    });

    it("catches the wholesale downgrade the count table is silent about", () => {
        // The disaster this step exists for: every item lands as plain text,
        // the totals add up, the problem count is zero, and the template is
        // useless.
        render(<PreviewStage structure={structure({
            sections: [{ title: "Roof", items: items(76, "plain") }],
        })} />);
        expect(anomalies()).toMatch(/most of|all of/i);
    });

    it("does not call an even split a wholesale downgrade", () => {
        // The design says the wholesale-downgrade sentence is for MORE than
        // half. Exactly half is the boundary, and it is the one value that a
        // `>=` reads as a disaster — a template where every second item kept
        // its ratings would be announced as the failure this step exists for.
        render(<PreviewStage structure={structure({
            sections: [
                { title: "Roof", items: items(38, "plain") },
                { title: "Interior", items: items(38, "rated") },
            ],
        })} />);
        expect(anomalies()).not.toMatch(/most of|all of/i);
        expect(anomalies()).toMatch(/38 items/);
    });

    it("calls one item past half a wholesale downgrade — the control", () => {
        // The other side of the boundary, from the same fixture size. Without
        // it the assertion above would also pass for a screen that never says
        // "most of" at all.
        render(<PreviewStage structure={structure({
            sections: [
                { title: "Roof", items: items(39, "plain") },
                { title: "Interior", items: items(38, "rated") },
            ],
        })} />);
        expect(anomalies()).toMatch(/most of/i);
    });

    it("does NOT call a deliberate list of choices a downgrade", () => {
        // The positive control that keeps the criterion honest: an item that
        // became a list of the operator's own answers is what he asked for.
        // A screen that counted anything-but-rated as a loss would shout at
        // every template imported that way.
        render(<PreviewStage structure={structure({
            sections: [{ title: "Roof", items: items(76, "choices") }],
        })} />);
        expect(anomalies()).not.toMatch(/most of|all of/i);
    });

    it("names sections that came through with nothing in them", () => {
        render(<PreviewStage structure={structure({
            sections: [
                { title: "Roof", items: items(3, "rated") },
                { title: "Executive Summary", items: [] },
            ],
        })} />);
        expect(anomalies()).toMatch(/Executive Summary/);
    });

    it("NAMES skipped entries rather than counting them", () => {
        // A count tells the operator something is missing without telling them
        // what — and the name is how they find it in their own file.
        render(<PreviewStage structure={structure({
            dropped: [{ at: "row 42", reason: "Executive Summary has no item" }],
        })} />);
        expect(screen.getByText(/Executive Summary has no item/)).toBeTruthy();
        expect(screen.getByText(/row 42/)).toBeTruthy();
    });

    it("does not say 'no problems' directly above a list of dropped entries", () => {
        // The two halves of this region were computed from different things:
        // the banner from the item landings, the list from `dropped`. A file
        // that converted cleanly but lost entries therefore rendered a green
        // "no problems found" immediately above the entries it lost — the
        // screen contradicting itself, in the one place built to be believed.
        render(<PreviewStage structure={structure({
            dropped: [{ at: "row 42", reason: "Executive Summary has no item" }],
        })} />);
        expect(anomalies()).not.toMatch(/no problems found/i);
        expect(anomalies()).toMatch(/Executive Summary has no item/);
    });

    it("names what the conversion had to decide, and does not call it a loss", () => {
        // The information exists and the screen was blind to it: a Spectora
        // export whose comment types this software does not recognise has them
        // filed under Information, and until now the only place that was said
        // was a generic sentence in the aftercare list that appears whether or
        // not it happened.
        render(<PreviewStage structure={structure({
            warnings: [{ code: "UNTYPED_COMMENTS", message: '3 comments said "summary"' }],
        })} />);
        expect(anomalies()).toMatch(/3 comments said "summary"/);
        expect(anomalies()).not.toMatch(/no problems found/i);
        // Not filed under losses: it came across, under a reading nobody chose.
        expect(anomalies()).not.toMatch(/could not bring over/i);
    });

    it("says so plainly when there are none — the positive control", () => {
        // An empty anomaly area and a missing one look identical, and the
        // former is the information.
        render(<PreviewStage structure={structure()} />);
        expect(anomalies()).toMatch(/no problems found/i);
    });

    it("says nothing about problems it does not have", () => {
        // The other half of the control above. A screen that always printed all
        // four sentences would satisfy every assertion in this file.
        render(<PreviewStage structure={structure()} />);
        expect(anomalies()).not.toMatch(/most of|all of/i);
        expect(anomalies()).not.toMatch(/items/i);
    });
});

describe("PreviewStage: the structure itself", () => {
    it("keeps the tree behind a disclosure rather than in front of the anomalies", () => {
        render(<PreviewStage structure={structure()} />);
        expect(screen.getByRole("button", { name: /full structure/i })).toBeTruthy();
        expect(screen.queryByText("Item 1")).toBeNull();
    });

    it("opens it when asked, which is the control on the line above", () => {
        render(<PreviewStage structure={structure()} />);
        fireEvent.click(screen.getByRole("button", { name: /full structure/i }));
        expect(screen.getByText("Item 1")).toBeTruthy();
        expect(screen.getAllByText("Roof").length).toBeGreaterThan(0);
    });
});

describe("PreviewStage: what usually needs adjusting", () => {
    it("says up front what an import of this kind normally leaves to do", () => {
        // Our conversion cannot be perfect — the rating reading is the
        // operator's own answer to a question no code can settle — and a
        // product that admits that beats one that leaves it to be discovered.
        render(<PreviewStage structure={structure()} />);
        expect(screen.getByTestId("preview-aftercare").textContent ?? "").not.toBe("");
    });

    it("says it even for a conversion with nothing wrong with it", () => {
        // It is not an error message. A clean conversion still needs the same
        // three things looked at, which is why it is not folded into the
        // anomaly list.
        render(<PreviewStage structure={structure()} />);
        expect(anomalies()).toMatch(/no problems found/i);
        expect(screen.getByTestId("preview-aftercare")).toBeTruthy();
    });
});
