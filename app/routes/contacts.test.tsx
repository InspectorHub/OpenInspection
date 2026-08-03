// @vitest-environment happy-dom
/**
 * IA-96 — /contacts carried three tabs that did not belong together:
 *
 *   "Contacts"  the full list, plus a type dropdown
 *   "Agents"    the SAME list narrowed to type === 'agent' — i.e. one setting
 *               of the dropdown sitting next to it, presented as a peer. A
 *               superset and its own subset as siblings, and a filter whose
 *               scope nobody could guess.
 *   "Roles"     not people at all; tenant configuration. Moved to
 *               Settings -> Inspection roles.
 *
 * What should remain is one list and one filter. These tests pin that, plus
 * the two things the restructure had to not lose: the referral count the
 * Agents tab uniquely showed, and the third contact type ('other') that the
 * role vocabulary has always had.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import ContactsPage from "~/routes/contacts";

const AGENT = {
  id: "c1",
  name: "Rosa Lindqvist",
  type: "agent",
  email: "rosa@example.com",
  phone: null,
  agency: "Northside Realty",
  inspectionCount: 4,
  referralCount: 3,
};
const CLIENT = { ...AGENT, id: "c2", name: "Tomas Beck", type: "client", agency: null, inspectionCount: 1, referralCount: 0 };
const OTHER = { ...AGENT, id: "c3", name: "Priya Anand", type: "other", agency: null, inspectionCount: 2, referralCount: 0 };

function renderContacts(contacts: unknown[], filterType = "") {
  const Stub = createRoutesStub([
    { path: "/contacts", Component: ContactsPage, loader: () => ({ contacts, filterType }) },
  ]);
  return render(<Stub initialEntries={["/contacts"]} />);
}

describe("/contacts — IA-96", () => {
  it("has no tab strip: one list, not three", async () => {
    const { findByText, queryAllByRole } = renderContacts([AGENT, CLIENT]);
    await findByText("Rosa Lindqvist");

    expect(queryAllByRole("tab")).toHaveLength(0);
    // Both contacts are on one list — an agent is not hidden behind a tab.
    expect(await findByText("Tomas Beck")).toBeTruthy();
  });

  it("keeps the referral count that only the Agents tab used to show", async () => {
    const { findByText, container } = renderContacts([AGENT]);
    await findByText("Rosa Lindqvist");

    const headers = [...container.querySelectorAll("th")].map((h) => h.textContent);
    expect(headers).toContain("Referrals");

    const row = container.querySelector("tbody tr");
    expect(row?.textContent).toContain("3");
  });

  it("offers 'other' as a filter — the role vocabulary's third kind", async () => {
    const { findByLabelText } = renderContacts([AGENT, CLIENT, OTHER]);
    const select = (await findByLabelText(/type/i)) as HTMLSelectElement;

    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(["", "agent", "client", "other"]);
  });

  it("does not repeat the same count in the title and the meta line", async () => {
    const { findByRole, container } = renderContacts([AGENT, CLIENT]);
    const heading = await findByRole("heading", { name: "Contacts" });

    expect(heading.textContent).toBe("Contacts");
    // The count lives in the meta, once — not restated in the heading.
    expect(container.textContent).toContain("2 contacts");
  });

  it("says what is shown AND out of how many when a filter is applied", async () => {
    const { findByRole, container } = renderContacts([AGENT, CLIENT, OTHER], "agent");
    await findByRole("heading", { name: "Contacts" });

    // One agent out of three contacts — a filtered page must not look like a
    // three-contact address book that lost two rows.
    expect(container.textContent).toContain("Showing 1");
    expect(container.textContent).toContain("3 contacts");
  });
});
