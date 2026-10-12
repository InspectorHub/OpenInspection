// @vitest-environment happy-dom
/** Two same-frame submits must reach the action once; the latch releases when the navigation settles. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { TwoFactorChallengeForm } from "./TwoFactorChallengeForm";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

function renderForm() {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <TwoFactorChallengeForm challengeToken="tok" returnTo="" />,
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return null;
            },
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("TwoFactorChallengeForm submit latch", () => {
    it("lets only one of two same-frame submits through, then releases", async () => {
        const { container } = renderForm();
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
