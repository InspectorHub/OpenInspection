/**
 * The Report Access panel makes a claim about access control, so its three
 * states have to stay distinguishable.
 *
 * The bug: `GET /{id}/access` returned 400, the loader caught it into an empty
 * array, and the page rendered "This contact cannot open any reports" for a
 * contact holding two live links. A failure was displayed as an authoritative
 * negative — the dangerous direction here, because an operator checking who can
 * still open a report acts on that answer.
 *
 * Same shape at the other end: the revoke action returns the number ACTUALLY
 * revoked (which can be lower than asked, when a link had already lapsed) and
 * nothing rendered it, so a failed revoke and a successful one looked alike.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import ContactDetailPage from "~/routes/contact-detail";

const CONTACT = {
  id: "fx-contact-agent",
  type: "agent",
  name: "Rosa Lindqvist",
  email: "rosa@northside.example.com",
  phone: null,
  agency: "Northside Realty",
  notes: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  archivedAt: null,
};

const DETAIL = {
  contact: CONTACT,
  inspections: [],
  stats: { inspectionCount: 0, totalRevenueCents: 0 },
};

const ACCESS = [
  { inspectionId: "i1", propertyAddress: "742 Evergreen Terrace", role: "buyer_agent", createdAt: 1 },
  { inspectionId: "i2", propertyAddress: "1 Lifecycle Publish Street", role: "buyer_agent", createdAt: 2 },
];

function renderDetail(loaderData: Record<string, unknown>) {
  const Stub = createRoutesStub([
    {
      path: "/contacts/:id",
      Component: ContactDetailPage,
      loader: () => loaderData,
    },
  ]);
  return render(<Stub initialEntries={["/contacts/fx-contact-agent"]} />);
}

describe("contact detail — report access", () => {
  it("lists the live links a contact holds", async () => {
    const { findByText } = renderDetail({ detail: DETAIL, access: ACCESS, accessFailed: false });

    expect(await findByText("742 Evergreen Terrace")).toBeTruthy();
    expect(await findByText("1 Lifecycle Publish Street")).toBeTruthy();
  });

  it("says the answer is NONE only when it actually knows that", async () => {
    const { findByText } = renderDetail({ detail: DETAIL, access: [], accessFailed: false });
    expect(await findByText(/cannot open any reports/i)).toBeTruthy();
  });

  it("does not claim 'no access' when the lookup failed", async () => {
    // The regression, stated directly: an empty list plus a failure flag must
    // never render the same sentence as an empty list with a good answer.
    const { findByText, queryByText } = renderDetail({
      detail: DETAIL,
      access: [],
      accessFailed: true,
    });

    expect(await findByText(/could not be loaded/i)).toBeTruthy();
    expect(queryByText(/cannot open any reports/i)).toBeNull();
  });

  it("offers no revoke control when it does not know what there is to revoke", async () => {
    // Offering "Revoke all" over an unknown set invites an operator to believe
    // the action covered everything.
    const { queryByText } = renderDetail({ detail: DETAIL, access: [], accessFailed: true });
    expect(queryByText(/revoke all/i)).toBeNull();
  });
});
