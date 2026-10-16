// @vitest-environment happy-dom
/**
 * Two submits dispatched in one frame must reach `fetcher.submit` once; the
 * latch releases when the fetcher returns to idle.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const fetcherMock = vi.hoisted(() => ({ state: "idle" as "idle" | "submitting", submit: vi.fn() }));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: undefined, submit: fetcherMock.submit, load: vi.fn() }),
    };
});

import { EditMemberDrawer } from "./EditMemberDrawer";

const MEMBER = { id: "m-1", name: "Dana", email: "dana@example.com", role: "inspector" };

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.submit.mockReset();
});
afterEach(cleanup);

function ui() {
    return <EditMemberDrawer actor={{ role: "owner", capabilities: null }} open onClose={() => {}} member={MEMBER} />;
}

function form(): HTMLFormElement {
    const f = document.getElementById("edit-member-form");
    if (!(f instanceof HTMLFormElement)) throw new Error("form not rendered");
    return f;
}

describe("EditMemberDrawer in-flight latch", () => {
    it("submits once when two submits land in one frame", () => {
        render(ui());
        const f = form();
        act(() => { f.requestSubmit(); f.requestSubmit(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
    });

    it("releases when the fetcher returns to idle so a failed save can be retried", () => {
        const { rerender } = render(ui());
        act(() => { form().requestSubmit(); form().requestSubmit(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
        fetcherMock.state = "submitting";
        rerender(ui());
        fetcherMock.state = "idle";
        rerender(ui());
        act(() => { form().requestSubmit(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(2);
    });
});
