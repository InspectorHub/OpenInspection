// @vitest-environment happy-dom
/**
 * Disconnecting a calendar removes the busy blocks it synced from the calendar
 * and from booking availability, so it asks first, in words that say so and that
 * the events in the external calendar are not changed. The request carries the
 * provider being disconnected; a refusal is shown.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { CalendarConnectPanel } from "./CalendarConnectPanel";

function mount(opts: { provider: "google" | "apple"; ok?: boolean }) {
    const posted: Array<Record<string, FormDataEntryValue>> = [];
    const Stub = createRoutesStub([{
        path: "/",
        Component: () => <CalendarConnectPanel connected capability="events_read_write" provider={opts.provider} oauthConfigured />,
        action: async ({ request }) => {
            posted.push(Object.fromEntries(await request.formData()));
            return opts.ok === false
                ? { ok: false, intent: "calendar-disconnect", message: "The calendar could not be disconnected." }
                : { ok: true, intent: "calendar-disconnect", message: null };
        },
    }]);
    return { ...render(<Stub initialEntries={["/"]} />), posted };
}

const openDialog = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /^disconnect$/i }));
    return await screen.findByRole("dialog");
};

describe("CalendarConnectPanel disconnect", () => {
    it("asks first, naming the provider and what is removed and what is not", async () => {
        const { posted } = mount({ provider: "google" });
        const dialog = await openDialog();
        const text = dialog.textContent ?? "";
        expect(text).toMatch(/Google/);
        expect(text).toMatch(/busy blocks/i);
        expect(text).toMatch(/availability/i);
        expect(text).toMatch(/not changed/i);
        fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
        await new Promise((r) => setTimeout(r, 40));
        expect(posted).toEqual([]);
    });

    it("says Apple for an Apple connection", async () => {
        mount({ provider: "apple" });
        expect((await openDialog()).textContent).toMatch(/Apple/);
    });

    it("confirming posts the provider once, even for two same-frame clicks", async () => {
        const { posted } = mount({ provider: "apple" });
        const dialog = await openDialog();
        const confirm = within(dialog).getAllByRole("button").at(-1)!;
        await act(async () => { confirm.click(); confirm.click(); });
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({ intent: "calendar-disconnect", provider: "apple" });
    });

    it("a refused disconnect shows an alert with the reason", async () => {
        mount({ provider: "google", ok: false });
        const dialog = await openDialog();
        fireEvent.click(within(dialog).getAllByRole("button").at(-1)!);
        expect((await screen.findByRole("alert")).textContent).toMatch(/could not be disconnected/);
    });
});
