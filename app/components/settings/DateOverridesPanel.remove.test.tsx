// @vitest-environment happy-dom
/**
 * Legacy and calendar-synced date overrides are listed on Settings -> Schedule
 * and used to be read-only, with a backend that can delete them and an action
 * wired for it that no control ever called. An override that blocks a date could
 * therefore not be cleared anywhere. Each row now has Remove behind a
 * confirmation; a refusal is shown and the row stays.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { DateOverridesPanel } from "./DateOverridesPanel";

const ROWS = [
  { id: "o1", date: "2026-12-24", isAvailable: false, startTime: null, endTime: null, source: null },
  { id: "o2", date: "2026-12-31", isAvailable: true, startTime: "09:00", endTime: "12:00", source: null },
];
const SYNCED = [
  { id: "g1", date: "2027-01-05", isAvailable: false, startTime: "10:00", endTime: "11:00", source: "google" as const },
  { id: "a1", date: "2027-01-06", isAvailable: false, startTime: "10:00", endTime: "11:00", source: "apple" as const },
];

function mount(ok: boolean, initial: Array<(typeof ROWS)[number] | (typeof SYNCED)[number]> = ROWS, message: string | null = null) {
  const posted: Array<Record<string, FormDataEntryValue>> = [];
  let rows = initial;
  const context = { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: { capabilities: {} } };
  const Stub = createRoutesStub([
    {
      id: "routes/auth-layout", path: "/", loader: () => ({ context }), Component: () => <Outlet />,
      children: [{
        path: "settings/schedule",
        loader: () => ({ rows }),
        Component: () => <DateOverridesPanel initialOverrides={rows as never} />,
        action: async ({ request }) => {
          const fd = Object.fromEntries(await request.formData());
          posted.push(fd);
          if (ok) rows = rows.filter((r) => r.id !== fd.id);
          return ok ? { ok, intent: "override-remove" } : { ok, intent: "override-remove", message };
        },
      }],
    },
  ]);
  return { ...render(<Stub initialEntries={["/settings/schedule"]} />), posted };
}

const removeButtons = () => screen.findAllByRole("button", { name: /^remove/i });
const confirm = async () => {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getAllByRole("button").at(-1)!);
};

describe("DateOverridesPanel remove", () => {
  it("offers Remove on every row", async () => {
    mount(true);
    expect(await removeButtons()).toHaveLength(2);
  });

  it("asks first, and cancelling sends nothing", async () => {
    const { posted } = mount(true);
    fireEvent.click((await removeButtons())[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await new Promise((r) => setTimeout(r, 40));
    expect(posted).toEqual([]);
  });

  it("a confirmed removal sends the row's id once and the row leaves the list", async () => {
    const { posted } = mount(true);
    fireEvent.click((await removeButtons())[0]!);
    await confirm();
    await waitFor(() => expect(posted).toEqual([expect.objectContaining({ intent: "override-remove", id: "o1" })]));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^remove/i })).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refused removal keeps the row and shows an alert", async () => {
    mount(false);
    fireEvent.click((await removeButtons())[0]!);
    await confirm();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be removed/i);
    expect(screen.getAllByRole("button", { name: /^remove/i })).toHaveLength(2);
  });

  it("a whole-day block says the day will be bookable again", async () => {
    mount(true);
    fireEvent.click((await removeButtons())[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/will follow the weekly schedule again, and customers will be able to book that day/);
  });

  it("an extra-hours row says the extra hours will no longer be offered", async () => {
    mount(true);
    fireEvent.click((await removeButtons())[1]!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/The extra hours on .* will no longer be offered for booking/);
  });

  it("synced rows have no Remove; they say where to change them", async () => {
    mount(true, [...ROWS, ...SYNCED]);
    await removeButtons();
    expect(screen.getAllByRole("button", { name: /^remove/i })).toHaveLength(2);
    expect(screen.getByText(/Synced from your Google calendar\. Change it there\./)).toBeTruthy();
    expect(screen.getByText(/Synced from your Apple calendar\. Change it there\./)).toBeTruthy();
  });

  it("a panel holding only synced rows offers no Remove at all", async () => {
    mount(true, SYNCED);
    await screen.findByText(/Synced from your Google calendar/);
    expect(screen.queryAllByRole("button", { name: /^remove/i })).toHaveLength(0);
  });

  it("a partial-window block says only that window opens again, never that the whole day does", async () => {
    mount(true, [{ id: "w1", date: "2026-12-24", isAvailable: false, startTime: "10:00", endTime: "12:00", source: null }]);
    fireEvent.click((await removeButtons())[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/10:00.12:00/);
    expect(dialog.textContent).toMatch(/available for booking again/);
    expect(dialog.textContent).not.toMatch(/that day/);
    expect(dialog.textContent).not.toMatch(/follow the weekly schedule again/);
  });

  it("a refusal that carries a reason shows the reason", async () => {
    mount(false, ROWS, "You can only manage your own availability");
    fireEvent.click((await removeButtons())[0]!);
    await confirm();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/You can only manage your own availability/);
  });
});
