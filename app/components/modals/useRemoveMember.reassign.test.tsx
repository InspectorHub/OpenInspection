// @vitest-environment happy-dom
/**
 * Removing a member who still has open inspections: the server answers with the
 * count, the dialog asks who takes them over, the confirm stays inert until a
 * choice is made, and the choice travels with the next request.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const fetcherMock = vi.hoisted(() => ({
    state: "idle" as "idle" | "submitting",
    data: undefined as { ok: boolean; error?: string; openInspections?: number } | undefined,
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

const TEAM = [
    { id: "m-1", name: "Dana Reyes", email: "dana@t.test", role: "inspector", status: "active" },
    { id: "m-2", name: "Lee Park", email: "lee@t.test", role: "manager", status: "active" },
    { id: "m-3", name: null, email: "agent@t.test", role: "agent", status: "active" },
    { id: "m-4", name: "Pending Pat", email: "pat@t.test", role: "inspector", status: "pending" },
];

function Harness() {
    const remove = useRemoveMember(TEAM);
    return (
        <>
            <button type="button" onClick={() => remove.open({ id: "m-1", name: "Dana Reyes" })}>open</button>
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

/** Open, confirm once, and let the server answer "3 open inspections". */
function reachPrompt() {
    const view = render(<Harness />);
    act(() => { screen.getByRole("button", { name: "open" }).click(); });
    act(() => { screen.getByRole("button", { name: "Remove member" }).click(); });
    fetcherMock.state = "submitting";
    view.rerender(<Harness />);
    fetcherMock.state = "idle";
    fetcherMock.data = { ok: false, error: "x", openInspections: 3 };
    view.rerender(<Harness />);
    fetcherMock.submit.mockClear();
    return view;
}

describe("removing a member with open inspections", () => {
    it("asks who takes over, offering active assignable teammates only", () => {
        reachPrompt();
        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain("Dana Reyes has 3 open inspections");
        const options = Array.from(dialog.querySelectorAll("option")).map((o) => o.textContent);
        expect(options).toContain("Lee Park");
        expect(options).toContain("Leave them unassigned");
        expect(options).not.toContain("Dana Reyes");
        expect(options).not.toContain("agent@t.test");
        expect(options).not.toContain("Pending Pat");
    });

    it("keeps confirm inert until a choice is made", () => {
        reachPrompt();
        act(() => { screen.getByRole("button", { name: "Remove member" }).click(); });
        expect(fetcherMock.submit).not.toHaveBeenCalled();
    });

    it("sends reassignTo for a teammate, once even on a double click", () => {
        reachPrompt();
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "m-2" } });
        const btn = screen.getByRole("button", { name: "Remove member" });
        act(() => { btn.click(); btn.click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
        expect(fetcherMock.submit.mock.calls[0]?.[0]).toMatchObject({ intent: "remove-member", id: "m-1", reassignTo: "m-2" });
    });

    it("sends unassign when that is chosen", () => {
        reachPrompt();
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "__unassign__" } });
        act(() => { screen.getByRole("button", { name: "Remove member" }).click(); });
        expect(fetcherMock.submit.mock.calls[0]?.[0]).toMatchObject({ intent: "remove-member", id: "m-1", unassign: "true" });
    });
});
