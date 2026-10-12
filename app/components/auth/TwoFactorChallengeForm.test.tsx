// @vitest-environment happy-dom
/** Two same-frame submits must reach the action once; the latch releases when the navigation settles. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub, redirect } from "react-router";
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

    it("stays latched while the redirect target loads: a second submit must not re-post the single-use code", async () => {
        // The action answers with a redirect at once; the next route's loader is slow, so the navigation sits in
        // "loading". Releasing the latch there would let a second click post the same one-time code again.
        let releaseLoader: () => void = () => {};
        const Stub = createRoutesStub([
            {
                path: "/",
                Component: () => <TwoFactorChallengeForm challengeToken="tok" returnTo="" />,
                action: async () => {
                    calls += 1;
                    return redirect("/done");
                },
            },
            {
                path: "/done",
                Component: () => <p>done</p>,
                loader: async () => {
                    await new Promise<void>((resolve) => { releaseLoader = resolve; });
                    return null;
                },
            },
        ]);
        const { container } = render(<Stub initialEntries={["/"]} />);
        const form = container.querySelector("form")!;
        act(() => { fireEvent.submit(form); });
        await waitFor(() => expect(calls).toBe(1));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        act(() => { fireEvent.submit(form); });
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(calls).toBe(1);
        await act(async () => { releaseLoader(); });
    });
});
