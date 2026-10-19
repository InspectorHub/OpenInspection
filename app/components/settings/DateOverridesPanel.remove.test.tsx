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
  { id: "o1", date: "2026-12-24", isAvailable: false, startTime: null, endTime: null },
  { id: "o2", date: "2026-12-31", isAvailable: true, startTime: "09:00", endTime: "12:00" },
];

function mount(ok: boolean) {
  const posted: Array<Record<string, FormDataEntryValue>> = [];
  let rows = ROWS;
  const context = { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: { capabilities: {} } };
  const Stub = createRoutesStub([
    {
      id: "routes/auth-layout", path: "/", loader: () => ({ context }), Component: () => <Outlet />,
      children: [{
        path: "settings/schedule",
        loader: () => ({ rows }),
        Component: () => <DateOverridesPanel initialOverrides={rows} />,
        action: async ({ request }) => {
          const fd = Object.fromEntries(await request.formData());
          posted.push(fd);
          if (ok) rows = rows.filter((r) => r.id !== fd.id);
          return { ok, intent: "override-remove" };
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
});
