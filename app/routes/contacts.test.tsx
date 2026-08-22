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
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import ContactsPage from "~/routes/contacts";
import { asSelect } from "../../tests/helpers/dom";

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
    const select = asSelect(await findByLabelText(/type/i), "the contact-type picker");

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

/**
 * `/contacts` — the same front door `/templates` already uses.
 *
 * This page used to own a private importer: a modal you pasted a CSV into (or
 * dropped a file on), which guessed which column held the name by matching
 * headers case-insensitively and, failing that, took the FIRST column. A guess
 * with no way to correct it, on the one question the file cannot answer.
 *
 * The wizard asks instead, and it asks on a run that can be reviewed, repaired
 * and undone. So what is asserted here is the ADDRESS and the ABSENCE:
 *
 *   1. every import control on this page resolves to the wizard's contacts
 *      entry, asserted as a set so a page with two controls pointing two ways
 *      fails even though both are links;
 *   2. using that control opens no paste form. Written as a CLICK, because the
 *      modal mounted its textarea only while open — the static "the document
 *      contains no textarea" form of this assertion is green against the very
 *      code it exists to reject.
 */
describe("/contacts — one front door", () => {
  const FRONT_DOOR = "/settings/imports?intent=contacts.import";

  it("sends the import control to the wizard, not to a modal", async () => {
    renderContacts([AGENT, CLIENT]);
    await screen.findByRole("heading", { name: "Contacts" });

    const links = screen.getAllByRole("link", { name: /import/i });
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(
      new Set([FRONT_DOOR]),
    );
  });

  it("opens no paste form when the import control is used", async () => {
    renderContacts([AGENT, CLIENT]);

    // POSITIVE CONTROL: the page rendered, and there is an import control to
    // use. A document that rendered nothing opens no paste form either, so
    // without this the assertion below passes for the wrong reason.
    expect(await screen.findByRole("heading", { name: "Contacts" })).toBeTruthy();
    expect(screen.getByText("Rosa Lindqvist")).toBeTruthy();
    const controls = [
      ...screen.queryAllByRole("button", { name: /import/i }),
      ...screen.queryAllByRole("link", { name: /import/i }),
    ];
    expect(controls.length).toBeGreaterThan(0);

    fireEvent.click(controls[0]);

    // Queried off the document rather than the render container: a modal goes
    // through a portal, and a container-scoped query cannot see it.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expect(screen.queryByText(/paste/i)).toBeNull();
  });

  it("still opens ADD as a button — the control that must NOT have become a link", async () => {
    // "Everything on this header is a link" would satisfy the first assertion
    // while having converted the wrong control.
    renderContacts([AGENT]);

    const add = await screen.findByRole("button", { name: /add contact/i });
    expect(add.tagName).toBe("BUTTON");
    expect(screen.queryByRole("link", { name: /add contact/i })).toBeNull();
  });
});
