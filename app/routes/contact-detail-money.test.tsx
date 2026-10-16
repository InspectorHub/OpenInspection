// @vitest-environment happy-dom
/**
 * A caller without the money capabilities gets a contact detail with the
 * money fields ABSENT. The page must say "not available to you" (a dash), never
 * "$0.00", which would read as a true statement about the contact's revenue.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import ContactDetailPage from "~/routes/contact-detail";

const CONTACT = {
  id: "c1", type: "client", name: "Jane Buyer", email: "jane@example.com", phone: null,
  agency: null, notes: null, createdAt: "2026-06-01T00:00:00.000Z", archivedAt: null,
};

const INSPECTION = { id: "i1", propertyAddress: "742 Evergreen Terrace", date: "2026-06-03", status: "completed", paymentStatus: "paid" };

function renderDetail(detail: Record<string, unknown>) {
  const Stub = createRoutesStub([
    {
      path: "/contacts/:id",
      Component: ContactDetailPage,
      loader: () => ({
        detail,
        access: [],
        accessFailed: false,
        qbo: { connected: false, link: { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 } },
      }),
    },
  ]);
  return render(<Stub initialEntries={["/contacts/c1"]} />);
}

const dashes = (el: HTMLElement) => (el.textContent ?? "").split("—").length - 1;

describe("contact detail — money visibility", () => {
  it("renders a dash, not $0.00, when revenue and price are absent (two more dashes than with the figures present)", async () => {
    const present = renderDetail({
      contact: CONTACT,
      inspections: [{ ...INSPECTION, price: 45000 }],
      stats: { inspectionCount: 1, totalRevenueCents: 45000, billedToOthersCents: 0 },
    });
    await present.findByText("742 Evergreen Terrace");
    // Positive control: the same page with the figures shows them as money.
    expect(present.container.textContent).toContain("$450.00");
    const baseline = dashes(present.container);
    present.unmount();

    const absent = renderDetail({
      contact: CONTACT,
      inspections: [INSPECTION],
      stats: { inspectionCount: 1 },
    });
    await absent.findByText("742 Evergreen Terrace");
    expect(absent.container.textContent).not.toContain("$0.00");
    // One dash for the revenue tile, one for the inspection's price.
    expect(dashes(absent.container)).toBe(baseline + 2);
  });
});
