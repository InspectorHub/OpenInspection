/**
 * The staff alert centre has to actually say what happened (IA-112).
 *
 * It rendered `notification.message`, a field that exists nowhere — not in the
 * DTO, not in the schema. Every row was an empty paragraph above a relative
 * timestamp, so the page that is meant to carry "new booking", "report ready"
 * and "new message" showed a list of times and nothing else. It compiled because
 * the payload was typed `unknown[]` and read through
 * `as Record<string, string>`, which will hand you `undefined` for any name you
 * ask for.
 *
 * So the first test asserts the content, and would have failed on the old code
 * for the right reason. The last one covers the other half: a failed fetch used
 * to be caught into an empty array, which rendered the "no notifications yet"
 * empty state — a lookup failure presented as a confident answer.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import NotificationsPage from "~/routes/notifications";

const ROW = {
  id: "n1",
  type: "booking.created",
  title: "New booking — 742 Evergreen Terrace",
  body: "Requested for Jul 23, 7:01 PM.",
  entityType: "inspection",
  entityId: "i1",
  readAt: null,
  archivedAt: null,
  createdAt: "2026-07-28T00:00:00.000Z",
};

function renderPage(loaderData: Record<string, unknown>) {
  const Stub = createRoutesStub([
    { path: "/notifications", Component: NotificationsPage, loader: () => loaderData },
  ]);
  return render(<Stub initialEntries={["/notifications"]} />);
}

describe("notifications page", () => {
  it("renders the notification's title and body", async () => {
    const { findByText } = renderPage({ notifications: [ROW], loadFailed: false });

    expect(await findByText("New booking — 742 Evergreen Terrace")).toBeTruthy();
    expect(await findByText("Requested for Jul 23, 7:01 PM.")).toBeTruthy();
  });

  it("renders a title-only notification without an empty body line", async () => {
    const { findByText, container } = renderPage({
      notifications: [{ ...ROW, body: null }],
      loadFailed: false,
    });

    await findByText("New booking — 742 Evergreen Terrace");
    // No blank paragraph — that is the shape the bug produced for every row.
    const empties = [...container.querySelectorAll("p")].filter(p => p.textContent === "");
    expect(empties).toHaveLength(0);
  });

  it("says the list is empty only when it actually knows that", async () => {
    const { findByText } = renderPage({ notifications: [], loadFailed: false });
    expect(await findByText(/no notifications/i)).toBeTruthy();
  });

  it("does not claim 'no notifications' when the lookup failed", async () => {
    const { findByText, queryByText } = renderPage({ notifications: [], loadFailed: true });

    expect(await findByText(/could not be loaded/i)).toBeTruthy();
    expect(queryByText(/no notifications/i)).toBeNull();
  });
});
