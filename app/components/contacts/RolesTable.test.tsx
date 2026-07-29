/**
 * Admin Roles tab table (Plan 1B Task 4). Covers the behaviors the review
 * checks for: renders the role-profile list, flags isSystem rows with a
 * "System" pill, hides the delete action on those same system rows (they
 * can never be deleted — see server/api/role-profiles.ts), and routes a row
 * click to the caller's onEdit (opens RoleProfileModal in edit mode).
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(() => ({
      state: "idle",
      data: undefined,
      submit: vi.fn(),
      load: vi.fn(),
      Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
        createElement("form", props, children),
    })),
  };
});

import { RolesTable } from "~/components/contacts/RolesTable";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";

const CLIENT_ROLE: RoleProfile = {
  id: "role-1",
  key: "buyer",
  label: "Buyer",
  kind: "client",
  emailTemplateId: null,
  smsTemplateId: null,
  isSystem: false,
  sortOrder: 1,
  active: true,
};

const SYSTEM_ROLE: RoleProfile = {
  id: "role-2",
  key: "agent",
  label: "Listing Agent",
  kind: "agent",
  emailTemplateId: null,
  smsTemplateId: null,
  isSystem: true,
  sortOrder: 0,
  active: true,
};

describe("RolesTable", () => {
  it("renders every role profile in the list", () => {
    const { getByText } = render(
      <RolesTable roleProfiles={[SYSTEM_ROLE, CLIENT_ROLE]} onEdit={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(getByText("Listing Agent")).toBeTruthy();
    expect(getByText("Buyer")).toBeTruthy();
  });

  it("shows a System pill on isSystem rows only", () => {
    const { getByText, getAllByText } = render(
      <RolesTable roleProfiles={[SYSTEM_ROLE, CLIENT_ROLE]} onEdit={vi.fn()} onCreate={vi.fn()} />,
    );
    // Exactly one "System" pill — on the isSystem row, not the tenant-defined one.
    expect(getAllByText("System")).toHaveLength(1);
    expect(getByText("System")).toBeTruthy();
  });

  it("hides the deactivate control on system rows but shows it on tenant-defined rows", () => {
    const { getByText, queryByText } = render(
      <RolesTable roleProfiles={[SYSTEM_ROLE, CLIENT_ROLE]} onEdit={vi.fn()} onCreate={vi.fn()} />,
    );
    // Only one row-level control should be rendered (for the non-system row).
    // IA-128 — the verb is "Deactivate", not "Delete": the endpoint is a soft
    // delete that flips active:false and leaves the row in place.
    const deleteButtons = document.querySelectorAll('button[type="submit"]');
    expect(deleteButtons).toHaveLength(1);
    expect(getByText("Deactivate")).toBeTruthy();
    expect(queryByText("Deactivate")?.closest("tr")?.textContent).toContain("Buyer");
  });

  it("offers Reactivate, not Deactivate, on an inactive row (IA-128)", () => {
    // The missing half of the pair. Deactivating a custom role used to be
    // terminal in the UI: the button still said "Delete", clicking it again did
    // nothing, and nothing in the app ever sent `active: true` — even though the
    // update schema had always accepted it.
    const { getByText, queryByText } = render(
      <RolesTable roleProfiles={[{ ...CLIENT_ROLE, active: false }]} onEdit={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(getByText("Reactivate")).toBeTruthy();
    expect(queryByText("Deactivate")).toBeNull();
  });

  it("calls onEdit with the row when a row is clicked", () => {
    const onEdit = vi.fn();
    const { getByText } = render(
      <RolesTable roleProfiles={[CLIENT_ROLE]} onEdit={onEdit} onCreate={vi.fn()} />,
    );
    getByText("Buyer").closest("tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith(CLIENT_ROLE);
  });

  it("calls onCreate when the Add Role button is clicked", () => {
    const onCreate = vi.fn();
    const { getByText } = render(
      <RolesTable roleProfiles={[]} onEdit={vi.fn()} onCreate={onCreate} />,
    );
    getByText("Add Role").click();
    expect(onCreate).toHaveBeenCalled();
  });
});
