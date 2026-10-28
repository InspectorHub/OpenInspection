// @vitest-environment happy-dom
/**
 * Blocking time over booked inspections asks first.
 *
 * Saving a calendar block used to say nothing when it covered an inspection that
 * was already booked. The drawer now checks before it saves: with no conflicts it
 * saves at once; with conflicts it lists them (each links to the inspection) and
 * saves only after an explicit confirmation. A check that cannot be answered never
 * blocks the save: the server does not require the confirmation, the page asks.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { BlockTimeDrawer } from "./BlockTimeDrawer";

type Conflict = { id: string; date: string; startTime: string | null; endTime: string | null };

function mount(opts: { conflicts?: Conflict[]; previewFails?: boolean; block?: boolean }) {
    const saved: Array<Record<string, FormDataEntryValue>> = [];
    const asked: string[] = [];
    const context = { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: { capabilities: {} } };
    const block = opts.block ? ({ id: "b1", title: "Dentist", start: "2027-03-10T10:00", extendedProps: { kind: "calendar_block", userId: "u1", date: "2027-03-10", startTime: "10:00", endTime: "11:00", allDay: false } } as never) : null;
    const Stub = createRoutesStub([{
        id: "routes/auth-layout", path: "/", loader: () => ({ context }), Component: () => <Outlet />,
        children: [
            {
                path: "calendar",
                Component: () => <BlockTimeDrawer open block={block} dateSeed="2027-03-10" currentUserId="u1" members={[]} canManageTeam={false} onClose={() => {}} />,
                action: async ({ request }) => { saved.push(Object.fromEntries(await request.formData())); return { ok: true, intent: "block-create" }; },
            },
            {
                path: "resources/block-conflicts",
                loader: ({ request }) => {
                    asked.push(new URL(request.url).search);
                    return opts.previewFails ? { ok: false, conflicts: [] } : { ok: true, conflicts: opts.conflicts ?? [] };
                },
            },
        ],
    }]);
    return { ...render(<Stub initialEntries={["/calendar"]} />), saved, asked };
}

/** The drawer's submit button lives outside its form (form="block-time-form"), so submit the form itself. */
const submitForm = () => (document.getElementById("block-time-form") as HTMLFormElement).requestSubmit();
/**
 * The drawer seeds its fields in an effect that runs AFTER the first paint (title and date start empty). Anything
 * done before that effect has run is overwritten, which leaves the required title empty and a form that silently
 * refuses to submit. The date is a field only the seed fills, so wait for it.
 */
const seeded = () =>
    waitFor(() => expect(document.querySelector<HTMLInputElement>('#block-time-form input[type="date"]')?.value).toBe("2027-03-10"));
const fillAndSubmit = async () => {
    const titleInput = await screen.findByLabelText(/^title$/i);
    await seeded();
    fireEvent.change(titleInput, { target: { value: "Dentist" } });
    const times = [...document.querySelectorAll<HTMLInputElement>('#block-time-form input[type="time"]')];
    fireEvent.change(times[0]!, { target: { value: "10:00" } });
    fireEvent.change(times[1]!, { target: { value: "11:00" } });
    submitForm();
};

describe("BlockTimeDrawer conflicts", () => {
    it("saves straight away when nothing is covered", async () => {
        const { saved, asked } = mount({ conflicts: [] });
        await fillAndSubmit();
        await waitFor(() => expect(saved).toHaveLength(1));
        // The router re-reads loaded data after the save, so the lookup may run again; the first is the pre-save check.
        expect(asked.length).toBeGreaterThanOrEqual(1);
        expect(asked[0]).toMatch(/startTime=10%3A00/);
        expect(screen.queryByText(/booked inspection/i)).toBeNull();
    });

    it("lists what is covered, links each inspection, and saves nothing until confirmed", async () => {
        const { saved } = mount({ conflicts: [{ id: "i-1", date: "2027-03-10", startTime: "09:00", endTime: "11:00" }, { id: "i-2", date: "2027-03-10", startTime: null, endTime: null }] });
        await fillAndSubmit();
        const dialog = await screen.findByRole("dialog", { name: /booked inspections/i });
        expect(dialog.textContent).toMatch(/2 booked inspections/i);
        expect(dialog.textContent).toMatch(/09:00.*11:00/);
        expect(dialog.textContent).toMatch(/time not set/i);
        const links = within(dialog).getAllByRole("link");
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["/inspections/i-1", "/inspections/i-2"]);
        expect(dialog.textContent).toMatch(/does not cancel or move/i);
        await new Promise((r) => setTimeout(r, 60));
        expect(saved).toEqual([]);
    });

    it("confirming saves once; going back saves nothing", async () => {
        const { saved } = mount({ conflicts: [{ id: "i-1", date: "2027-03-10", startTime: "09:00", endTime: "11:00" }] });
        await fillAndSubmit();
        let dialog = await screen.findByRole("dialog", { name: /booked inspection/i });
        fireEvent.click(within(dialog).getByRole("button", { name: /go back/i }));
        await new Promise((r) => setTimeout(r, 60));
        expect(saved).toEqual([]);
        submitForm();
        dialog = await screen.findByRole("dialog", { name: /booked inspection/i });
        fireEvent.click(within(dialog).getByRole("button", { name: /block anyway/i }));
        await waitFor(() => expect(saved).toHaveLength(1));
    });

    it("a check that fails does not stop the save", async () => {
        const { saved } = mount({ previewFails: true });
        await fillAndSubmit();
        await waitFor(() => expect(saved).toHaveLength(1));
    });

    it("editing a block checks too", async () => {
        const { asked } = mount({ conflicts: [], block: true });
        await screen.findByRole("button", { name: /save changes/i });
        await seeded();
        const times = [...document.querySelectorAll<HTMLInputElement>('#block-time-form input[type="time"]')];
        fireEvent.change(times[0]!, { target: { value: "10:00" } });
        fireEvent.change(times[1]!, { target: { value: "11:00" } });
        submitForm();
        await waitFor(() => expect(asked.length).toBeGreaterThanOrEqual(1));
        expect(asked[0]).toMatch(/date=2027-03-10/);
    });
});
