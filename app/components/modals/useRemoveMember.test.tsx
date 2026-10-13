// @vitest-environment happy-dom
/**
 * The dialog state machine behind the Team page's "Remove": two confirms in
 * one frame send one request, a failure keeps the dialog open with the
 * server's sentence, and success closes it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const fetcherMock = vi.hoisted(() => ({
    state: "idle" as "idle" | "submitting",
    data: undefined as { ok: boolean; error?: string } | undefined,
    submit: vi.fn(),
}));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: fetcherMock.data, submit: fetcherMock.submit, load: vi.fn() }),
    };
});

import { RemoveMemberDialog } from "./RemoveMemberDialog";
import { useRemoveMember } from "./useRemoveMember";

const DANA = { id: "m-1", name: "Dana Reyes" };

function Harness() {
    const remove = useRemoveMember();
    return (
        <>
            <button type="button" onClick={() => remove.open(DANA)}>open</button>
            <RemoveMemberDialog {...remove.dialogProps} />
        </>
    );
}

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.data = undefined;
    fetcherMock.submit.mockReset();
});
afterEach(cleanup);

function openDialog() {
    act(() => { screen.getByRole("button", { name: "open" }).click(); });
}
const confirmButton = () => screen.getByRole("button", { name: "Remove member" });

describe("useRemoveMember", () => {
    it("sends one request when confirm is clicked twice in one frame", () => {
        render(<Harness />);
        openDialog();
        const btn = confirmButton();
        act(() => { btn.click(); btn.click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
        expect(fetcherMock.submit.mock.calls[0]?.[0]).toMatchObject({ intent: "remove-member", id: "m-1" });
    });

    it("keeps the dialog open and shows the server's sentence when the removal is refused", () => {
        const { rerender } = render(<Harness />);
        openDialog();
        act(() => { confirmButton().click(); });
        fetcherMock.state = "submitting";
        rerender(<Harness />);
        fetcherMock.state = "idle";
        fetcherMock.data = { ok: false, error: "Cannot remove the last owner" };
        rerender(<Harness />);
        expect(screen.getByRole("dialog").textContent).toContain("Cannot remove the last owner");
    });

    it("closes once the removal succeeds", () => {
        const { rerender } = render(<Harness />);
        openDialog();
        act(() => { confirmButton().click(); });
        fetcherMock.state = "submitting";
        rerender(<Harness />);
        fetcherMock.state = "idle";
        fetcherMock.data = { ok: true };
        rerender(<Harness />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not show a previous attempt's error when reopened for someone else", () => {
        fetcherMock.data = { ok: false, error: "stale refusal" };
        render(<Harness />);
        openDialog();
        expect(screen.getByRole("dialog").textContent).not.toContain("stale refusal");
    });
});
