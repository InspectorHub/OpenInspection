// @vitest-environment happy-dom
/**
 * The modal must reopen after a successful submit.
 *
 * A fetcher keeps its last result indefinitely. The close-on-success effect
 * read that result unconditionally, so the second time you opened the same
 * modal it closed itself on the same tick, off a success from minutes earlier —
 * the button simply stopped working, with no error anywhere.
 *
 * The first pass through any flow looks perfect, which is why this needs a test
 * rather than a walkthrough. It surfaced on the inspection workspace, where
 * "send the agreement again to add a co-signer" made the second open a normal
 * thing to do; the single-recipient send it replaced never reopened.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useModalFetcher } from "./useModalFetcher";

afterEach(cleanup);

type Result = { ok: boolean; intent: string; error?: string };

function Harness() {
    const modal = useModalFetcher<() => Result>("send-thing");
    return (
        <div>
            <button onClick={() => modal.setOpen(true)}>open</button>
            {modal.open && (
                <div>
                    <span>dialog</span>
                    <button onClick={() => modal.fetcher.submit({ intent: "send-thing" }, { method: "post" })}>
                        submit
                    </button>
                    <button onClick={() => modal.setOpen(false)}>close</button>
                </div>
            )}
            {modal.error && <span>err:{modal.error}</span>}
            <span>succeeded:{String(modal.succeeded)}</span>
        </div>
    );
}

function renderHarness(result: Result) {
    const Stub = createRoutesStub([
        { path: "/", Component: Harness, action: () => result },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

const openIt = () => fireEvent.click(screen.getByText("open"));
const submitIt = () => fireEvent.click(screen.getByText("submit"));

describe("useModalFetcher", () => {
    it("closes on success, then reopens — the second open is not eaten by the first success", async () => {
        renderHarness({ ok: true, intent: "send-thing" });

        openIt();
        expect(screen.getByText("dialog")).toBeTruthy();

        submitIt();
        await waitFor(() => expect(screen.queryByText("dialog")).toBeNull());
        expect(screen.getByText("succeeded:true")).toBeTruthy();

        // The whole point: the stale success must not slam it shut again.
        openIt();
        expect(screen.getByText("dialog")).toBeTruthy();
        // ...and it must stay open past the effect tick that closed it before.
        await waitFor(() => expect(screen.getByText("dialog")).toBeTruthy());
        expect(screen.getByText("succeeded:false")).toBeTruthy();
    });

    it("keeps the modal open on failure and surfaces the error", async () => {
        renderHarness({ ok: false, intent: "send-thing", error: "nope" });

        openIt();
        submitIt();

        await waitFor(() => expect(screen.getByText("err:nope")).toBeTruthy());
        expect(screen.getByText("dialog")).toBeTruthy();
    });

    it("drops a stale error when the modal is dismissed and reopened", async () => {
        renderHarness({ ok: false, intent: "send-thing", error: "nope" });

        openIt();
        submitIt();
        await waitFor(() => expect(screen.getByText("err:nope")).toBeTruthy());

        // Dismiss, then come back: reopening is a fresh attempt, and last run's
        // complaint is not about it.
        fireEvent.click(screen.getByText("close"));
        openIt();
        await waitFor(() => expect(screen.queryByText("err:nope")).toBeNull());
        expect(screen.getByText("dialog")).toBeTruthy();
    });

    it("ignores a result belonging to another intent", async () => {
        renderHarness({ ok: true, intent: "something-else" });

        openIt();
        submitIt();

        await waitFor(() => expect(screen.getByText("succeeded:false")).toBeTruthy());
        expect(screen.getByText("dialog")).toBeTruthy();
    });
});
