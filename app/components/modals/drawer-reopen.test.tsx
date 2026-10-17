// @vitest-environment happy-dom
/**
 * A drawer that closes itself after a successful save must open again afterwards.
 *
 * The fetcher keeps its last result after the drawer closes, and the parent passes an inline `onClose`
 * (a new function every render). A close effect that reads the fetcher's result on every run therefore
 * saw the OLD success on the next opening and closed the drawer in the same commit, so Edit and Invite
 * did nothing until a reload. The drawer must react only to a result that arrives while it is mounted
 * and not yet handled.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useState } from "react";

const fetcherMock = vi.hoisted(() => ({
    state: "idle" as "idle" | "submitting",
    data: undefined as unknown,
    submit: vi.fn(),
}));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: fetcherMock.data, submit: fetcherMock.submit, load: vi.fn() }),
    };
});

import { EditMemberDrawer } from "./EditMemberDrawer";
import { InviteSeatDrawer } from "./InviteSeatDrawer";

const MEMBER = { id: "m-1", name: "Dana", email: "dana@example.com", role: "inspector" };
const ACTOR = { role: "owner", capabilities: null };

let openRef: { open: () => void; isOpen: () => boolean };

function EditHarness() {
    const [member, setMember] = useState<typeof MEMBER | null>(null);
    openRef = { open: () => setMember(MEMBER), isOpen: () => member !== null };
    return <EditMemberDrawer actor={ACTOR} open={member !== null} onClose={() => setMember(null)} member={member} />;
}

function InviteHarness() {
    const [open, setOpen] = useState(false);
    openRef = { open: () => setOpen(true), isOpen: () => open };
    return <InviteSeatDrawer actor={ACTOR} open={open} onClose={() => setOpen(false)} />;
}

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.data = undefined;
    fetcherMock.submit.mockReset();
});
afterEach(cleanup);

function run(Harness: () => React.JSX.Element, intent: string) {
    const view = render(<Harness />);
    const drawerOpen = () => openRef.isOpen();
    // The parent re-renders (as it does on every loader revalidation) and the drawer is opened.
    act(() => openRef.open());
    expect(drawerOpen(), "opens the first time").toBe(true);

    // A save completes: a NEW result object arrives.
    fetcherMock.data = { ok: true, intent, error: null, url: null };
    view.rerender(<Harness />);
    expect(drawerOpen(), "closes after its own successful save").toBe(false);

    // The fetcher still holds that result. Opening again must stay open, including across re-renders.
    act(() => openRef.open());
    expect(drawerOpen(), "reopens after a save").toBe(true);
    view.rerender(<Harness />);
    view.rerender(<Harness />);
    expect(drawerOpen(), "stays open across parent re-renders").toBe(true);

    // And a second save still closes it: the guard is per result, not once per mount.
    fetcherMock.data = { ok: true, intent, error: null, url: null };
    view.rerender(<Harness />);
    expect(drawerOpen(), "closes after a second successful save").toBe(false);
}

describe("drawers reopen after a successful save", () => {
    it("Edit member", () => run(EditHarness, "update"));
    it("Invite", () => run(InviteHarness, "invite"));
});
