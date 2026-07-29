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
    // The card reads the viewer's locale/timezone (IA-36 ⑪ renders link dates)
    // via useSessionContext → useRouteLoaderData, which needs a data router.
    // Undefined = the hooks fall back to en-US / UTC.
    useRouteLoaderData: () => undefined,
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

const CO_CLIENT: PersonRow = {
  id: "p3",
  contactId: "c3",
  roleProfileId: "role-co-client",
  roleKey: "co_client",
  roleLabel: "Co-Client",
  kind: "client",
  name: "Chris Co-Client",
  email: "chris@example.com",
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

  // IA-36 ⑫⑬ — the primary client used to have NO remove control at all, so a
  // leaked or mis-picked primary client had no in-product remedy. Every row now
  // carries the action; the one genuine limit is stated, not hidden.
  it("renders Remove on every row, including the primary client", () => {
    const { getByText, queryAllByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[PRIMARY_CLIENT, CO_CLIENT, AGENT_PERSON]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    expect(getByText("Primary")).toBeTruthy();
    expect(queryAllByText("Remove from inspection")).toHaveLength(3);
  });

  it("disables Remove for the ONLY client and says why, instead of hiding the button", () => {
    const { getByText, getAllByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[PRIMARY_CLIENT, AGENT_PERSON]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    const buttons = getAllByText("Remove from inspection") as HTMLButtonElement[];
    const clientRemove = buttons.find((b) =>
      b.closest("div.flex.items-start")?.textContent?.includes("Jane Client"),
    )!;
    const agentRemove = buttons.find((b) =>
      b.closest("div.flex.items-start")?.textContent?.includes("Amy Agent"),
    )!;
    expect(clientRemove.disabled).toBe(true);
    expect(agentRemove.disabled).toBe(false);
    expect(getByText("Add another client or make someone else primary first")).toBeTruthy();
  });

  it("offers Make primary only on a non-primary CLIENT row — never on an agent", () => {
    const { getAllByText, queryAllByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[PRIMARY_CLIENT, CO_CLIENT, AGENT_PERSON]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    const makePrimary = getAllByText("Make primary");
    expect(makePrimary).toHaveLength(1);
    expect(makePrimary[0].closest("div.flex.items-start")?.textContent).toContain("Chris Co-Client");
    expect(queryAllByText("Make primary").some((b) =>
      b.closest("div.flex.items-start")?.textContent?.includes("Amy Agent"),
    )).toBe(false);
  });

  it("submits person-make-primary when Make primary is clicked", () => {
    submitMock.mockClear();
    const { getByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[PRIMARY_CLIENT, CO_CLIENT]}
        roleProfiles={[CLIENT_ROLE]}
        isAdmin
      />,
    );
    fireEvent.click(getByText("Make primary"));
    expect(submitMock).toHaveBeenCalledWith(
      { intent: "person-make-primary", personId: "p3" },
      { method: "post" },
    );
  });

  // IA-36 ② — Reset goes through a confirm modal (never window.confirm), and the
  // copy names the consequence: the URL the customer holds dies now.
  it("confirms Reset access link before rotating, then submits person-reset-access", () => {
    submitMock.mockClear();
    const { getAllByText, getByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[
          { ...PRIMARY_CLIENT, access: { status: "active", sentAt: 1_700_000_000_000, expiresAt: null } },
          AGENT_PERSON,
        ]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    fireEvent.click(getAllByText("Reset access link")[0]);
    expect(getByText(/stops working immediately/)).toBeTruthy();
    expect(submitMock).not.toHaveBeenCalled();

    fireEvent.click(getByText("Reset link"));
    expect(submitMock).toHaveBeenCalledWith(
      { intent: "person-reset-access", personId: "p1" },
      { method: "post" },
    );
  });

  it("describes Reset as a RESTORE when the link is already revoked (IA-134)", () => {
    // The confirm copy assumed the recipient is holding a working link, and
    // this control is offered on revoked and expired rows too. There, the
    // operation is not destruction — it is the only way back, since report
    // tokens are unique per (inspection, recipient) and re-adding someone
    // reissues nothing (IA-133). Telling an operator that "their link stops
    // working" in the one case where they have no working link is backwards.
    const { getAllByText, getByText, queryByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[
          { ...AGENT_PERSON, access: { status: "revoked", sentAt: 1_700_000_000_000, expiresAt: null } },
        ]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    fireEvent.click(getAllByText("Reset access link")[0]);

    expect(getByText(/no working link right now/)).toBeTruthy();
    expect(queryByText(/stops working immediately/)).toBeNull();
  });

  // Caught reviewing the real card: a person who was never sent a link was
  // still offered Reset, and the endpoint can only answer 404 for them.
  it("offers Reset only to someone who actually has a link", () => {
    const { queryAllByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[
          { ...PRIMARY_CLIENT, access: { status: "active", sentAt: 1_700_000_000_000, expiresAt: null } },
          { ...AGENT_PERSON, access: { status: "not_sent", sentAt: null, expiresAt: null } },
        ]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    const resets = queryAllByText("Reset access link");
    expect(resets).toHaveLength(1);
    expect(resets[0].closest("div.flex.items-start")?.textContent).toContain("Jane Client");
  });

  // IA-36 ⑪ — the row says what the link IS before offering to change it.
  it("shows per-recipient link state", () => {
    const { getByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[
          { ...PRIMARY_CLIENT, access: { status: "revoked", sentAt: 1_700_000_000_000, expiresAt: null } },
          { ...AGENT_PERSON, access: { status: "not_sent", sentAt: null, expiresAt: null } },
        ]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    expect(getByText("Access revoked")).toBeTruthy();
    expect(getByText("No report link sent yet")).toBeTruthy();
  });

  // IA-36 ⑭ — mailto stays, but it is labelled as leaving the product.
  it("labels the mailto link as opening the local mail app", () => {
    const { getByText } = render(
      <PeopleEditor inspectionId="insp-1" people={[AGENT_PERSON]} roleProfiles={[AGENT_ROLE]} isAdmin />,
    );
    const mail = getByText("amy@realty.com") as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toBe("mailto:amy@realty.com");
    expect(mail.getAttribute("title")).toMatch(/own email app/i);
  });

  // IA-36 ⑥⑦ — the expiry control only appears when there is something to act
  // on, and the button states the consequence rather than saying "Apply".
  it("offers the link-expiry control only once links have actually been sent", () => {
    const { queryByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[{ ...PRIMARY_CLIENT, access: { status: "not_sent", sentAt: null, expiresAt: null } }]}
        roleProfiles={[CLIENT_ROLE]}
        isAdmin
      />,
    );
    expect(queryByText("Report link expiry")).toBeNull();
  });

  it("names the number of links the expiry would hit", () => {
    const { getByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[
          { ...PRIMARY_CLIENT, access: { status: "active", sentAt: 1_700_000_000_000, expiresAt: null } },
          { ...AGENT_PERSON, access: { status: "active", sentAt: 1_700_000_000_000, expiresAt: null } },
        ]}
        roleProfiles={[CLIENT_ROLE, AGENT_ROLE]}
        isAdmin
      />,
    );
    expect(getByText("Report link expiry")).toBeTruthy();
    expect(getByText("Remove the expiry from 2 sent links")).toBeTruthy();
  });

  // Reviewing the real page turned this up: with nothing expiring and the
  // control on "Never", the button was live but would have changed nothing.
  it("disables the expiry action when it would change nothing, and says so", () => {
    const { getByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[{ ...PRIMARY_CLIENT, access: { status: "active", sentAt: 1_700_000_000_000, expiresAt: null } }]}
        roleProfiles={[CLIENT_ROLE]}
        isAdmin
      />,
    );
    const btn = getByText("Remove the expiry from the 1 sent link") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(getByText(/nothing to change/i)).toBeTruthy();
  });

  it("singularizes the expiry action for exactly one link", () => {
    const { getByText, queryByText } = render(
      <PeopleEditor
        inspectionId="insp-1"
        people={[{ ...PRIMARY_CLIENT, access: { status: "active", sentAt: 1_700_000_000_000, expiresAt: 1_800_000_000_000 } }]}
        roleProfiles={[CLIENT_ROLE]}
        isAdmin
      />,
    );
    expect(getByText("Remove the expiry from the 1 sent link")).toBeTruthy();
    expect(queryByText(/1 sent links/)).toBeNull();
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
