// @vitest-environment happy-dom
/**
 * Two submits dispatched in one frame must reach the action once.
 *
 * `navigation.state` is still "idle" when the second one arrives, so the guard
 * cannot read it: it is a ref set inside the handler and released when the
 * navigation settles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { Form, createRoutesStub, useFetcher } from "react-router";
import { useSubmitLatch } from "./useSubmitLatch";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

function Harness({ veto = false }: { veto?: boolean }) {
    const latch = useSubmitLatch();
    return (
        <Form
            method="post"
            data-testid="form"
            onSubmit={latch(veto ? (e) => e.preventDefault() : undefined)}
        >
            <button type="submit">go</button>
        </Form>
    );
}

function renderHarness(veto = false) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <Harness veto={veto} />,
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return null;
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

const form = () => screen.getByTestId("form");

describe("useSubmitLatch", () => {
    it("lets only one of two same-frame submits through", async () => {
        renderHarness();
        act(() => {
            fireEvent.submit(form());
            fireEvent.submit(form());
        });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });

    it("CONTROL - releases once the navigation settles, so a later submit goes through", async () => {
        renderHarness();
        act(() => { fireEvent.submit(form()); });
        await waitFor(() => expect(calls).toBe(1));
        await act(async () => { release(); });
        await waitFor(() => {
            fireEvent.submit(form());
            expect(calls).toBe(2);
        });
        await act(async () => { release(); });
    });

    it("does not latch a submit the wrapped handler vetoed", async () => {
        renderHarness(true);
        act(() => {
            fireEvent.submit(form());
            fireEvent.submit(form());
        });
        expect(calls).toBe(0);
    });
});

function FetcherHarness() {
    const fetcher = useFetcher();
    const latch = useSubmitLatch(fetcher.state);
    return (
        <fetcher.Form method="post" data-testid="fform" onSubmit={latch()}>
            <button type="submit">go</button>
        </fetcher.Form>
    );
}

function renderFetcherHarness() {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: FetcherHarness,
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return null;
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

describe("useSubmitLatch with a fetcher", () => {
    it("follows the fetcher: two same-frame submits post once", async () => {
        renderFetcherHarness();
        const f = () => screen.getByTestId("fform");
        act(() => {
            fireEvent.submit(f());
            fireEvent.submit(f());
        });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });

    it("CONTROL - releases when the fetcher returns to idle, since navigation never leaves idle", async () => {
        renderFetcherHarness();
        const f = () => screen.getByTestId("fform");
        act(() => { fireEvent.submit(f()); });
        await waitFor(() => expect(calls).toBe(1));
        await act(async () => { release(); });
        await waitFor(() => {
            fireEvent.submit(f());
            expect(calls).toBe(2);
        });
        await act(async () => { release(); });
    });
});
