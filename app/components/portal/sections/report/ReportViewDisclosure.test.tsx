// @vitest-environment happy-dom
/** Two same-frame submits of the objection control must reach the action once; the latch then releases. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ReportViewDisclosure } from "./ReportViewDisclosure";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

function renderDisclosure() {
    const Stub = createRoutesStub([
        { path: "/", Component: () => <ReportViewDisclosure inspectionId="insp1" token="t" /> },
        {
            path: "/resources/view-tracking",
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false };
            },
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("ReportViewDisclosure submit latch", () => {
    it("lets only one of two same-frame submits through, then releases", async () => {
        const { container } = renderDisclosure();
        const form = container.querySelector("form")!;
        act(() => {
            fireEvent.submit(form);
            fireEvent.submit(form);
        });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
        await waitFor(() => {
            fireEvent.submit(form);
            expect(calls).toBe(2);
        });
        await act(async () => { release(); });
    });
});
