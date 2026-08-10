// @vitest-environment happy-dom
/**
 * The key lifecycle is the whole point: mint on mount, HOLD across a failure,
 * ROTATE on success.
 *
 * Both halves are load-bearing in opposite directions. A key that rotates too
 * eagerly lets the retry of a failed submit look like a brand-new request, which
 * is the duplicate this exists to stop. A key that never rotates is worse: the
 * deliberate second thing the user creates replays the first one's stored
 * response, so they are told it worked and nothing was written.
 *
 * The in-flight guard is a ref, not `fetcher.state`. `fetcher.submit()` disables
 * nothing synchronously and does not flip `state` before the handler returns, so
 * a double click lands entirely inside one render — reading `state` catches
 * nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useGuardedSubmit } from "./useGuardedSubmit";

afterEach(cleanup);

/** Every form body the action received, in order. */
let calls: Array<Record<string, string>> = [];
beforeEach(() => {
    calls = [];
});

function Harness() {
    const guard = useGuardedSubmit<{ ok: boolean }>();
    return (
        <div>
            <button onClick={() => guard.submit({ intent: "create" }, { method: "post" })}>submit</button>
            <span data-testid="key">{guard.idempotencyKey}</span>
            <span data-testid="busy">{String(guard.busy)}</span>
        </div>
    );
}

function renderHarness(result: { ok: boolean }) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: Harness,
            action: async ({ request }) => {
                const fd = await request.formData();
                calls.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
                return result;
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

const submitIt = () => fireEvent.click(screen.getByText("submit"));
const keyNow = () => screen.getByTestId("key").textContent ?? "";
const landed = (n: number) => waitFor(() => expect(calls.length).toBe(n));
/**
 * Wait on BUSY, and do not "improve" this to wait on the key span.
 *
 * `busy` comes from `fetcher.state`, which goes idle BEFORE the settle effect
 * rotates the key. So a submit fired right after this resolves lands in the
 * narrowest moment of the key lifecycle — which is exactly the moment worth
 * testing. Waiting for the rendered key to change instead would skip past it and
 * the rotation test would pass no matter what the hook did.
 *
 * That is not hypothetical: the rotation test below failed in a loaded full suite
 * while passing alone, because the hook released its in-flight guard before the
 * new key was reachable and the second submit went out carrying the spent one.
 */
const settled = () => waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("false"));

describe("useGuardedSubmit", () => {
    it("swallows a second submit fired before the first re-render", async () => {
        renderHarness({ ok: true });

        // Both clicks inside ONE act(): React batches the two handlers and
        // renders nothing between them, so `fetcher.state` still reads "idle"
        // when the second one runs. That is the real double click — dispatching
        // them through separate `fireEvent` calls lets a render slip in and the
        // state check appears to work when it does not.
        const btn = screen.getByText("submit");
        act(() => {
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        await landed(1);
        await settled();
        expect(calls.length).toBe(1);
    });

    it("attaches the current key to the payload", async () => {
        renderHarness({ ok: true });

        const minted = keyNow();
        expect(minted).not.toBe("");

        submitIt();
        await landed(1);
        expect(calls[0].idempotencyKey).toBe(minted);
        // The caller's own fields survive the wrapping.
        expect(calls[0].intent).toBe("create");
    });

    it("holds the key across a failed submit, so the retry is the same request", async () => {
        renderHarness({ ok: false });

        submitIt();
        await landed(1);
        await settled();

        submitIt();
        await landed(2);
        expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
    });

    it("rotates the key after a successful submit, so the next one is a new request", async () => {
        renderHarness({ ok: true });

        submitIt();
        await landed(1);
        await settled();

        submitIt();
        await landed(2);
        expect(calls[1].idempotencyKey).not.toBe(calls[0].idempotencyKey);
    });
});
