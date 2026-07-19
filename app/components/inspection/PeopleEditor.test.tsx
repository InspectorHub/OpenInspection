/**
 * Plan 1B Task 5 — editable People section on the inspection detail page.
 * Covers what the review checks for: renders people grouped by role kind
 * (Client / Agents / Other), shows the "Add person" button, marks the
 * primary-client row "Primary" with no remove control, and — via
 * AddPersonModal — calls the dedicated add fetcher's submit on an inline
 * create + submit.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createElement } from "react";

const submitMock = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(() => ({
      state: "idle",
      data: undefined,
      submit: submitMock,
      load: vi.fn(),
      Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
        createElement("form", props, children),
    })),
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [k: string]: unknown }) =>
      createElement("a", { href: to, ...props }, children),
  };
});

import { PeopleEditor, type PersonRow } from "./PeopleEditor";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";

const CLIENT_ROLE: RoleProfile = {
  id: "role-client",
  key: "client",
  label: "Client",
  kind: "client",
  emailTemplateId: null,
  smsTemplateId: null,
  isSystem: true,
  sortOrder: 10,
  active: true,
};

const AGENT_ROLE: RoleProfile = {
  id: "role-agent",
  key: "buyer_agent",
  label: "Buyer's Agent",
  kind: "agent",
  emailTemplateId: null,
  smsTemplateId: null,
  isSystem: true,
  sortOrder: 30,
  active: true,
};

const PRIMARY_CLIENT: PersonRow = {
  id: "p1",
  contactId: "c1",
  roleProfileId: "role-client",
  roleKey: "client",
  roleLabel: "Client",
  kind: "client",
  name: "Jane Client",
  email: "jane@example.com",
  phone: null,
  agency: null,
};

const AGENT_PERSON: PersonRow = {
  id: "p2",
  contactId: "c2",
  roleProfileId: "role-agent",
  roleKey: "buyer_agent",
  roleLabel: "Buyer's Agent",
  kind: "agent",
  name: "Amy Agent",
  email: "amy@realty.com",
  phone: null,
  agency: "Sunrise Realty",
};

describe("PeopleEditor", () => {
  it("groups people by role kind — Client and Agents sections both render", () => {
    const { getByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[PRIMARY_CLIENT, AGENT_PERSON]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    expect(getByText("Client")).toBeTruthy();
    expect(getByText("Agents")).toBeTruthy();
    expect(getByText("Jane Client")).toBeTruthy();
    expect(getByText("Amy Agent")).toBeTruthy();
  });

  it("shows the Add person button", () => {
    const { getByText } = render(
      <PeopleEditor inspectionId="insp-1" people={[]} roleProfiles={[CLIENT_ROLE]} isAdmin />,
    );
    expect(getByText("Add person")).toBeTruthy();
  });

  it("marks the primary client row Primary and hides its remove button, but shows Remove on the agent row", () => {
    const { getByText, queryAllByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[PRIMARY_CLIENT, AGENT_PERSON]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    expect(getByText("Primary")).toBeTruthy();
    // Exactly one Remove control — the agent row, not the primary client.
    const removeButtons = queryAllByText("Remove");
    expect(removeButtons).toHaveLength(1);
    expect(removeButtons[0].closest("div")?.textContent).toContain("Amy Agent");
  });

  it("calls the add fetcher's submit with the person-add intent on inline-create submit", () => {
    submitMock.mockClear();
    const { getByText, getByPlaceholderText } = render(
      <PeopleEditor inspectionId="insp-1" people={[]} roleProfiles={[CLIENT_ROLE, AGENT_ROLE]} isAdmin />,
    );

    fireEvent.click(getByText("Add person"));
    fireEvent.click(getByText("Create a new contact instead"));
    fireEvent.change(getByPlaceholderText("Full name"), { target: { value: "New Person" } });

    const roleSelect = document.querySelector("select") as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "role-client" } });

    fireEvent.click(getByText("Add"));

    expect(submitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "person-add",
        roleProfileId: "role-client",
        newContactName: "New Person",
      }),
      { method: "post" },
    );
  });
});
