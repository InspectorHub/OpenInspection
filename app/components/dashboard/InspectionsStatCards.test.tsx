// @vitest-environment happy-dom
/**
 * A stat card that LOOKS clickable must BE clickable — and clickable here means
 * a real link, not a div with a handler.
 *
 * All four cards shipped with `cursor-pointer`, a hover lift and a transition,
 * and none of them with an `onClick`, a `Link` or a target of any kind. The
 * pointer cursor is a promise the component could not keep: the user aims at
 * "Needs Attention: 3", clicks, and nothing happens. The affordance is the
 * defect, so the inert case gets its own assertion rather than riding along
 * behind the happy path — a card with no target must render with NO
 * `cursor-pointer` at all. An inert number is honest; a fake affordance is not.
 *
 * And a target has to be an anchor with an href, because middle-click and
 * "open in new tab" are the whole reason to look at a number and want the list
 * beside the one you are already reading.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { InspectionsStatCards, type StatKey } from "~/components/dashboard/InspectionsStatCards";

const COUNTS = { upcoming: 3, inProgress: 2, needsAttention: 1, recent: 4 };

const ALL_TARGETS: Partial<Record<StatKey, string>> = {
    upcoming: "/inspections?focus=upcoming",
    inProgress: "/inspections?focus=in_progress",
    needsAttention: "/inspections?focus=needs_attention",
    recent: "/inspections?focus=recent",
};

function renderCards(targets?: Partial<Record<StatKey, string>>) {
    const Stub = createRoutesStub([
        {
            path: "/inspections",
            Component: () => <InspectionsStatCards counts={COUNTS} targets={targets} />,
        },
    ]);
    return render(<Stub initialEntries={["/inspections"]} />);
}

describe("InspectionsStatCards", () => {
    it("gives every card that advertises a click a real link to click", () => {
        const { container } = renderCards(ALL_TARGETS);
        const pointers = Array.from(container.querySelectorAll(".cursor-pointer"));
        expect(pointers).toHaveLength(4);
        // The contract, stated once: a pointer cursor implies an href above it.
        for (const el of pointers) {
            expect(el.closest("a[href]")).not.toBeNull();
        }
    });

    it("points each card at its own bucket", () => {
        const { container } = renderCards(ALL_TARGETS);
        const hrefs = Array.from(container.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
        expect(hrefs).toEqual([
            "/inspections?focus=upcoming",
            "/inspections?focus=in_progress",
            "/inspections?focus=needs_attention",
            "/inspections?focus=recent",
        ]);
    });

    it("renders a card with no target inert — no link AND no pointer cursor", () => {
        const { container, getByText } = renderCards({ upcoming: "/inspections?focus=upcoming" });
        // Only the one card with a target is a link.
        expect(container.querySelectorAll("a[href]")).toHaveLength(1);
        expect(container.querySelectorAll(".cursor-pointer")).toHaveLength(1);
        // And the targetless one carries no affordance anywhere in its subtree.
        const label = getByText("Needs Attention");
        const card = label.closest("div.rounded-ih-card");
        expect(card).not.toBeNull();
        expect(card!.className).not.toContain("cursor-pointer");
        expect(card!.closest("a")).toBeNull();
    });

    it("renders every card inert when given no targets at all", () => {
        const { container } = renderCards();
        expect(container.querySelectorAll("a[href]")).toHaveLength(0);
        expect(container.querySelectorAll(".cursor-pointer")).toHaveLength(0);
    });
});
