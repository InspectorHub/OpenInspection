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
        name: "AHIT Master",
        sections: [{ title: "Roof", items: items(3, "rated") }],
        dropped: [],
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
