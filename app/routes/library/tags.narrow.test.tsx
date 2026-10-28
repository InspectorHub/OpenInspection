// @vitest-environment happy-dom
/**
 * At phone width the tags table keeps its Actions column on screen: the colour
 * name (which the swatch already shows) is the column that drops out, through
 * the table's own container query rather than a viewport breakpoint.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import TagsPage from "./tags";

afterEach(cleanup);

describe("/library/tags - narrow table", () => {
    it("hides the colour column below the container breakpoint and keeps Actions", async () => {
        const Stub = createRoutesStub([
            {
                path: "/",
                Component: TagsPage,
                loader: () => ({ tags: [{ id: "t1", name: "Radon", color: "indigo", count: 2 }], canManage: true, loadFailed: false }),
            },
        ]);
        const { container } = render(<Stub initialEntries={["/"]} />);
        await screen.findByText("Radon");
        const headers = Array.from(container.querySelectorAll("th"));
        const color = headers.find((th) => /colou?r/i.test(th.textContent ?? ""));
        expect(color?.className).toContain("hidden");
        expect(color?.className).toContain("@md:table-cell");
        const actions = headers[headers.length - 1];
        expect(actions.className).not.toContain("hidden");
        expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    });
});
