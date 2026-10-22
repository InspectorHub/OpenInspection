// @vitest-environment happy-dom
/**
 * The editor route's `shouldRevalidate` skips router POST submissions (the editor holds its own state and
 * saves through its command route), but an explicit `revalidator.revalidate()` must still re-run the loader:
 * the data source's `reload()` (after publish, finish fieldwork, a units or property-type change) relies on it.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { createRoutesStub, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { shouldRevalidate } from "~/routes/inspection-edit";

function mount() {
    let loads = 0;
    const Page = () => {
        const data = useLoaderData() as { n: number };
        const revalidator = useRevalidator();
        const fetcher = useFetcher();
        return (
            <div>
                <span data-testid="n">{data.n}</span>
                <button onClick={() => void revalidator.revalidate()}>reload</button>
                <button onClick={() => void fetcher.submit({ intent: "x" }, { method: "post" })}>post</button>
            </div>
        );
    };
    const Stub = createRoutesStub([{
        path: "/",
        Component: Page,
        shouldRevalidate,
        loader: () => { loads += 1; return { n: loads }; },
        action: () => ({ ok: true }),
    }]);
    render(<Stub />);
    return () => loads;
}

describe("inspection-edit shouldRevalidate", () => {
    it("an explicit revalidate re-runs the loader and the page shows the new data", async () => {
        const loads = mount();
        await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("1"));
        fireEvent.click(screen.getByText("reload"));
        await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("2"));
        expect(loads()).toBe(2);
    });

    it("CONTROL: a router POST submission does not re-run the loader", async () => {
        const loads = mount();
        await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("1"));
        fireEvent.click(screen.getByText("post"));
        await new Promise((r) => setTimeout(r, 80));
        expect(loads()).toBe(1);
    });
});
