// @vitest-environment happy-dom
/**
 * The Repair Items page offers Add / Edit / Delete only when the API would
 * accept them: /api/recommendations is gated by templateCreate, templateEdit and
 * templateDelete. A control shown to someone who lacks the capability is a button
 * that can only produce a refusal.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { m } from "~/paraglide/messages";
import RepairItemsPage from "~/routes/repair-items";

afterEach(cleanup);

const ITEM = {
  id: "ri-1", name: "Replace flashing", category: null, severity: "significant" as const,
  defaultRepairSummary: "Replace the failed flashing.", recommendedContractorTypeId: null,
};

function renderWith(capabilities: Record<string, boolean>) {
  const context = {
    branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
    user: { capabilities },
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
          loader: () => ({ items: [ITEM], contractorTypes: [], loadFailed: false }),
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/library/repair-items"]} />);
}

const has = (name: string) => screen.queryByRole("button", { name }) !== null;

describe("/library/repair-items capability gating", () => {
  it("shows Add, Edit and Delete when all three capabilities are held (control)", async () => {
    renderWith({ templateCreate: true, templateEdit: true, templateDelete: true });
    await screen.findByText(ITEM.name);
    expect(has(m.repair_items_add())).toBe(true);
    expect(has(m.common_edit())).toBe(true);
    expect(has(m.common_delete())).toBe(true);
  });

  it("hides Delete but keeps Add and Edit for an inspector with the default grants", async () => {
    renderWith({ templateCreate: true, templateEdit: true, templateDelete: false });
    await screen.findByText(ITEM.name);
    expect(has(m.repair_items_add())).toBe(true);
    expect(has(m.common_edit())).toBe(true);
    expect(has(m.common_delete())).toBe(false);
  });

  it("hides every write control when no capability is held", async () => {
    renderWith({});
    await screen.findByText(ITEM.name);
    expect(has(m.repair_items_add())).toBe(false);
    expect(has(m.common_edit())).toBe(false);
    expect(has(m.common_delete())).toBe(false);
  });
});
