// @vitest-environment happy-dom
/**
 * The scope control in the invite and edit drawers: which inspections an inspector can see.
 *
 * Rendered rather than only unit-tested, because the control and the request have to agree: the
 * screen is what the request carries, including the one case where a company default of
 * "only assigned" would otherwise decide for an inspector the inviter meant to give everything.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

const fetcherMock = vi.hoisted(() => ({ state: "idle" as "idle" | "submitting", submit: vi.fn() }));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: undefined, submit: fetcherMock.submit, load: vi.fn() }),
    };
});

import { InviteSeatDrawer } from "./InviteSeatDrawer";
import { EditMemberDrawer } from "./EditMemberDrawer";

const OWNER = { role: "owner", capabilities: null };

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.submit.mockReset();
});
afterEach(cleanup);

/** The one FormData the drawer handed to fetcher.submit. */
function submitted(): Record<string, string> {
    expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
    const fd = fetcherMock.submit.mock.calls[0]![0] as FormData;
    return Object.fromEntries(fd.entries()) as Record<string, string>;
}

const scopeRadio = (c: ReturnType<typeof render>, label: string) => c.getByLabelText(label) as HTMLInputElement;
const scheduleOthers = (c: ReturnType<typeof render>) => {
    // The capability list sits under a disclosure in the invite drawer.
    const toggle = c.queryByRole("button", { name: /advanced/i });
    if (toggle && toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
    return c.getByLabelText(/Schedule for others/) as HTMLInputElement;
};
const submitInvite = (c: ReturnType<typeof render>) => {
    fireEvent.change(c.container.querySelector('input[type="email"]')!, { target: { value: "new@example.com" } });
    const form = document.getElementById("invite-seat-form") as HTMLFormElement;
    act(() => { form.requestSubmit(); });
};

describe("InviteSeatDrawer scope control", () => {
    it("offers the control for an inspector, defaulting to every inspection", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} />);
        expect(c.getByText("Inspections this person can see")).toBeTruthy();
        expect(scopeRadio(c, "All inspections").checked).toBe(true);
        expect(scopeRadio(c, "Only inspections assigned to them").checked).toBe(false);
        // The explanation appears only once it applies.
        expect(c.queryByText("Unassigned inspections are visible to managers and owners only.")).toBeNull();
    });

    it("does not offer it for a manager, whose role pins the scope", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} />);
        fireEvent.change(c.getByRole("combobox"), { target: { value: "manager" } });
        expect(c.queryByText("Inspections this person can see")).toBeNull();
    });

    it("choosing 'only assigned' explains the consequence, greys out scheduling for others, and sends the restriction", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} />);
        fireEvent.click(scopeRadio(c, "Only inspections assigned to them"));
        expect(c.getByText("Unassigned inspections are visible to managers and owners only.")).toBeTruthy();
        const sched = scheduleOthers(c);
        expect(sched.disabled).toBe(true);
        expect(sched.checked).toBe(false);
        expect(c.getByText("Requires access to all inspections")).toBeTruthy();
        submitInvite(c);
        expect(JSON.parse(submitted().permissionOverrides!)).toEqual({ viewAllInspections: false });
    });

    it("control: scheduling for others stays available while the inspector sees everything", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} />);
        expect(scheduleOthers(c).disabled).toBe(false);
    });

    it("sends nothing about the scope when the company default is 'all' and the inviter leaves it alone (the request is what it always was)", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} newInspectorsViewAll />);
        submitInvite(c);
        expect(submitted().permissionOverrides).toBeUndefined();
    });

    it("opens on 'only assigned' when the company default restricts new inspectors, and that is what is sent", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} newInspectorsViewAll={false} />);
        expect(scopeRadio(c, "Only inspections assigned to them").checked).toBe(true);
        submitInvite(c);
        expect(JSON.parse(submitted().permissionOverrides!)).toEqual({ viewAllInspections: false });
    });

    it("under a restricting company default, choosing 'all inspections' is sent outright so the default cannot decide for them", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} newInspectorsViewAll={false} />);
        fireEvent.click(scopeRadio(c, "All inspections"));
        submitInvite(c);
        expect(JSON.parse(submitted().permissionOverrides!)).toEqual({ viewAllInspections: true });
    });

    it("two submits in one frame still send once (the existing latch holds with the control present)", () => {
        const c = render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} />);
        fireEvent.change(c.container.querySelector('input[type="email"]')!, { target: { value: "new@example.com" } });
        const form = document.getElementById("invite-seat-form") as HTMLFormElement;
        act(() => { form.requestSubmit(); form.requestSubmit(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
    });
});

describe("EditMemberDrawer scope control", () => {
    const member = (overrides: Record<string, boolean> | null, role = "inspector") =>
        ({ id: "m-1", name: "Dana", email: "dana@example.com", role, permissionOverrides: overrides });
    const edit = (m: ReturnType<typeof member>) => <EditMemberDrawer actor={OWNER} open onClose={() => {}} member={m} />;
    const saveEdit = () => {
        const form = document.getElementById("edit-member-form") as HTMLFormElement;
        act(() => { form.requestSubmit(); });
    };

    it("shows a restricted inspector on 'only assigned', and saves the restriction back", () => {
        const c = render(edit(member({ viewAllInspections: false })));
        expect(scopeRadio(c, "Only inspections assigned to them").checked).toBe(true);
        saveEdit();
        expect(JSON.parse(submitted().permissionOverrides!)).toEqual({ viewAllInspections: false });
    });

    it("lifting the restriction saves an empty override map, which clears it", () => {
        const c = render(edit(member({ viewAllInspections: false })));
        fireEvent.click(scopeRadio(c, "All inspections"));
        saveEdit();
        expect(JSON.parse(submitted().permissionOverrides!)).toEqual({});
    });

    it("restricting an unrestricted inspector saves the restriction and drops scheduling for others", () => {
        const c = render(edit(member({ scheduleOthers: true })));
        expect(scheduleOthers(c).checked).toBe(true);
        fireEvent.click(scopeRadio(c, "Only inspections assigned to them"));
        expect(scheduleOthers(c).disabled).toBe(true);
        saveEdit();
        expect(JSON.parse(submitted().permissionOverrides!)).toEqual({ viewAllInspections: false });
    });

    it("a manager has no scope control", () => {
        const c = render(edit(member(null, "manager")));
        expect(c.queryByText("Inspections this person can see")).toBeNull();
    });
});
