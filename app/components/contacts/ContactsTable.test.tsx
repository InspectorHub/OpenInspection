// @vitest-environment happy-dom
/**
 * F30 / F35 — the contacts table overflowed at 1232px (a laptop, not a phone)
 * and produced a 696px document at a 390px viewport.
 *
 * ⚠️ happy-dom has no layout engine, so nothing here measures a pixel. What it
 * can pin is the thing that was wrong: every one of the eight columns rendered
 * unconditionally, so the table's intrinsic width was a constant no container
 * could be narrow enough for. The assertions below are about WHICH question
 * decides a column's visibility — the table's own width, not the viewport's —
 * because a viewport breakpoint is exactly the bug F56 documents: the content
 * area beside a 256px sidebar is nothing like the viewport.
 *
 * Measured geometry (1232px: ~1038px of columns in a ~928px content area)
 * comes from the browser pass.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ContactsTable } from "./ContactsTable";
import type { Contact } from "./contacts-helpers";

const ROWS: Contact[] = [
  {
    id: "c1",
    name: "Rosa Lindqvist",
    type: "agent",
    email: "rosa.lindqvist@northside-realty-group.example.com",
    phone: "555-0100",
    agency: "Northside Realty",
    inspectionCount: 4,
    referralCount: 3,
  } as Contact,
];

function renderTable() {
  const Stub = createRoutesStub([
    {
      path: "/contacts",
      Component: () => (
        <ContactsTable filtered={ROWS} onEdit={() => {}} onArchive={() => {}} onRestore={() => {}} />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/contacts"]} />);
}

/** The `<th>` whose text is `label`, plus the `<td>` under it in row one. */
function column(label: RegExp) {
  const th = screen.getByText(label).closest("th") as HTMLElement;
  const index = Array.from(th.parentElement!.children).indexOf(th);
  const td = document.querySelector("tbody tr")!.children[index] as HTMLElement;
  return { th, td };
}

// Anything that would make a column's visibility depend on the WINDOW.
const VIEWPORT_VARIANT = /(^|\s)(sm|md|lg|xl|2xl):/;

describe("contacts table — the width that decides a column", () => {
  it("queries the table's own width, not the viewport's", () => {
    const { container } = renderTable();
    const wrapper = container.querySelector("table")!.parentElement as HTMLElement;
    // Without this the `@` variants below resolve against nothing and every
    // column is permanently visible — the class names would still be there.
    expect(wrapper.className).toContain("@container");
  });

  it("always shows identity and verbs", () => {
    renderTable();
    for (const label of [/^Name$/i, /^Type$/i, /^Email$/i]) {
      expect(column(label).th.className).not.toContain("hidden");
    }
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /archive/i })).toBeTruthy();
  });

  it("drops the four secondary columns until the table is wide enough", () => {
    renderTable();
    for (const label of [/^Phone$/i, /^Agency$/i, /^Inspections$/i, /^Referrals$/i]) {
      const { th, td } = column(label);
      // Hidden by default, restored by a CONTAINER query.
      expect(th.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(th.className).toMatch(/@\d?x?l:table-cell/);
      expect(th.className).not.toMatch(VIEWPORT_VARIANT);
      // The cell has to carry the same rule, or the header and its data part
      // company by one column the moment either one hides.
      expect(td.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(td.className).toMatch(/@\d?x?l:table-cell/);
    }
  });

  it("lets an email address break so it is not a floor under the table", () => {
    renderTable();
    const { th, td } = column(/^Email$/i);
    // An address is one unbroken word: its min-content width (~170px for a
    // normal one) was a width no container could go below.
    expect(th.className).toContain("wrap-anywhere");
    expect(td.className).toContain("wrap-anywhere");
  });
});
