// @vitest-environment happy-dom
/**
 * Two submits of the update choice dispatched in one frame must reach the route
 * action once, on both the clean-update form and the conflict form.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import MarketplaceUpdatePage from "./marketplace-update";

afterEach(cleanup);

let posts = 0;
let release: () => void = () => {};
beforeEach(() => {
    posts = 0;
    release = () => {};
});

const base = { libraryId: "lib1", libraryName: "Roof comments", fromSemver: "1.0.0", toSemver: "2.0.0", total: 5, publisherChanged: 2, edited: 1 };
const pair = { commentId: "c1", section: null, yours: "My words", editedAt: 1, published: { kind: "changed" as const, text: "Their words" } };

async function check(pairs: unknown[]) {
    const Stub = createRoutesStub([
        {
            path: "/library/marketplace/:libraryId/update",
            Component: MarketplaceUpdatePage,
            loader: () => ({ preview: { ...base, pairs } }),
            action: async () => {
                posts += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false };
            },
        },
    ]);
    const { container } = render(<Stub initialEntries={["/library/marketplace/lib1/update"]} />);
    const button = await waitFor(() => {
        const found = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
        expect(found).not.toBeNull();
        return found!;
    });
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(posts).toBe(1));
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(posts).toBe(1);
    await act(async () => { release(); });
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
    act(() => { button.click(); });
    await waitFor(() => expect(posts).toBe(2));
    await act(async () => { release(); });
}

describe("marketplace-update", () => {
    it("applies a clean update once for a double click", async () => {
        await check([]);
    });

    it("applies the chosen resolution once for a double click", async () => {
        await check([pair]);
    });
});
