// @vitest-environment happy-dom
/**
 * The add/edit dialog is the shared Modal, so it gets Escape, a Tab trap, scroll lock and
 * focus return for free; a hand-rolled overlay had none of them.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { m } from "~/paraglide/messages";
import RepairItemsPage from "~/routes/repair-items";

afterEach(cleanup);

function renderPage() {
  const context = {
    branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
    user: { capabilities: { templateCreate: true, templateEdit: true, templateDelete: true } },
  };
  const Stub = createRoutesStub([
    {
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({ context }),
      Component: () => <Outlet />,
      children: [
        {
          path: "library/repair-items",
          Component: RepairItemsPage,
          action: () => ({ ok: true, intent: "create" }),
          loader: () => ({ items: [], contractorTypes: [], loadFailed: false }),
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/library/repair-items"]} />);
}

describe("/library/repair-items add dialog", () => {
  it("opens as a modal dialog and closes on Escape when idle", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: m.repair_items_add() }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Save inert until the required fields are filled (native disabled for validation)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: m.repair_items_add() }));
    const dialog = await screen.findByRole("dialog");
    const save = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === m.common_save()) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
