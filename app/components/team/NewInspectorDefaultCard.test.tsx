// @vitest-environment happy-dom
/**
 * The company default for new inspectors, on the Team page. One press sends one request even when two
 * land in the same frame, a failed save says so and leaves the saved value on screen, and the line that
 * says existing members are untouched is always there (a switch on a team page invites the opposite guess).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

const fetcherMock = vi.hoisted(() => ({
    state: "idle" as "idle" | "submitting",
    data: undefined as { ok: boolean; error?: string } | undefined,
    formData: undefined as FormData | undefined,
    submit: vi.fn(),
}));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: fetcherMock.data, formData: fetcherMock.formData, submit: fetcherMock.submit, load: vi.fn() }),
    };
});

import { NewInspectorDefaultCard } from "./NewInspectorDefaultCard";

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.data = undefined;
    fetcherMock.formData = undefined;
    fetcherMock.submit.mockReset();
});
afterEach(cleanup);

const box = (c: ReturnType<typeof render>) => c.getByLabelText("New inspectors can see all inspections") as HTMLInputElement;

describe("NewInspectorDefaultCard", () => {
    it("shows the saved value and says it only applies from now on", () => {
        const c = render(<NewInspectorDefaultCard viewAll={false} />);
        expect(box(c).checked).toBe(false);
        expect(c.getByText("Applies to inspectors you invite from now on. Existing members keep their current setting.")).toBeTruthy();
        cleanup();
        expect(box(render(<NewInspectorDefaultCard viewAll />)).checked).toBe(true);
    });

    it("sends the new value once when two presses land in the same frame", () => {
        const c = render(<NewInspectorDefaultCard viewAll />);
        const input = box(c);
        act(() => { input.click(); input.click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
        expect(fetcherMock.submit).toHaveBeenCalledWith(
            expect.objectContaining({ intent: "set-new-inspector-default", viewAll: "false" }), { method: "post" },
        );
    });

    it("lets a later press through once the fetcher has returned to idle", () => {
        const c = render(<NewInspectorDefaultCard viewAll />);
        act(() => { box(c).click(); });
        fetcherMock.state = "submitting";
        c.rerender(<NewInspectorDefaultCard viewAll />);
        fetcherMock.state = "idle";
        c.rerender(<NewInspectorDefaultCard viewAll />);
        act(() => { box(c).click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(2);
    });

    it("shows the value being saved while the request is in flight, and disables the switch", () => {
        fetcherMock.state = "submitting";
        fetcherMock.formData = new FormData();
        fetcherMock.formData.set("viewAll", "false");
        const c = render(<NewInspectorDefaultCard viewAll />);
        expect(box(c).checked).toBe(false);
        expect(box(c).disabled).toBe(true);
    });

    it("says so when the save failed, and the switch goes back to the saved value", () => {
        fetcherMock.data = { ok: false, error: "HTTP 500" };
        const c = render(<NewInspectorDefaultCard viewAll />);
        expect(c.getByRole("alert").textContent).toBe("HTTP 500");
        expect(box(c).checked).toBe(true);
    });

    it("shows no error when the last save went through (control)", () => {
        fetcherMock.data = { ok: true };
        const c = render(<NewInspectorDefaultCard viewAll />);
        expect(c.queryByRole("alert")).toBeNull();
    });

    it("ignores a click on a disabled switch (control: nothing is sent)", () => {
        fetcherMock.state = "submitting";
        const c = render(<NewInspectorDefaultCard viewAll />);
        fireEvent.click(box(c));
        expect(fetcherMock.submit).not.toHaveBeenCalled();
    });
});
