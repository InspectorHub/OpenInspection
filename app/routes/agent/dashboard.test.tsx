/**
 * Spec 3 Task 4c — dashboard welcome banner + highlight for the
 * just-converted inspection.
 *
 * After signup.tsx redirects a converting agent to
 * `/agent-dashboard?welcome=<inspectionId>`, the dashboard should surface a
 * dismissible welcome banner and, when that inspection is already present in
 * the referrals list (server-side auto-link), highlight + pin its row.
 *
 * Pattern: render via createRoutesStub (mirrors
 * app/routes/agent/settings-profile.test.tsx) so useState/dismiss behavior
 * exercises through real React, not just loader/action plumbing.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import AgentDashboardPage from "~/routes/agent/dashboard";

const REFERRAL_I1 = {
  id: "i1",
  tenantName: "Acme Inspections",
  tenantSlug: "acme",
  propertyAddress: "123 Main St",
  clientName: "Jane Client",
  date: "2026-07-18",
  status: "delivered",
  reportStatus: "published",
  inspectorName: "Bob Inspector",
};

const REFERRAL_I2 = {
  id: "i2",
  tenantName: "Acme Inspections",
  tenantSlug: "acme",
  propertyAddress: "456 Oak Ave",
  clientName: "John Client",
  date: "2026-07-10",
  status: "scheduled",
  reportStatus: null,
  inspectorName: null,
};

function renderDashboard(opts: {
  referrals?: typeof REFERRAL_I1[];
  welcomeInspectionId?: string | null;
  unreadReports?: number;
}) {
  const Stub = createRoutesStub([
    {
      path: "/agent-dashboard",
      Component: AgentDashboardPage,
      loader: () => ({
        referrals: opts.referrals ?? [],
        unreadReports: opts.unreadReports ?? 0,
        welcomeInspectionId: opts.welcomeInspectionId ?? null,
      }),
    },
  ]);
  return render(<Stub initialEntries={["/agent-dashboard"]} />);
}

describe("AgentDashboardPage welcome banner + highlight", () => {
  it("shows the welcome banner and highlights + pins the matching referral row", async () => {
    const { findByText, findByTestId } = renderDashboard({
      referrals: [REFERRAL_I2, REFERRAL_I1],
      welcomeInspectionId: "i1",
    });

    await findByText("Welcome! Here's the inspection you were just added to.");

    const row = await findByTestId("referral-row-i1");
    expect(row.getAttribute("data-welcome-highlight")).toBe("true");
    expect(row.className).toContain("ring-ih-primary");

    // Pinned to the top of its tenant group — i1 should now precede i2 in
    // the DOM even though it was second in the loader-supplied list.
    const i2Row = await findByTestId("referral-row-i2");
    expect(i2Row.getAttribute("data-welcome-highlight")).toBeNull();
    expect(row.compareDocumentPosition(i2Row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the banner without a highlight when the welcomed inspection isn't in referrals yet", async () => {
    const { findByText, queryByTestId } = renderDashboard({
      referrals: [REFERRAL_I2],
      welcomeInspectionId: "i1",
    });

    await findByText("Welcome! Here's the inspection you were just added to.");
    expect(queryByTestId("referral-row-i1")).toBeNull();

    const i2Row = queryByTestId("referral-row-i2");
    expect(i2Row?.getAttribute("data-welcome-highlight")).toBeNull();
  });

  it("shows no banner and default grouping when welcome is unset", async () => {
    const { queryByText, findByTestId } = renderDashboard({
      referrals: [REFERRAL_I1, REFERRAL_I2],
      welcomeInspectionId: null,
    });

    expect(
      queryByText("Welcome! Here's the inspection you were just added to."),
    ).toBeNull();

    const row = await findByTestId("referral-row-i1");
    expect(row.getAttribute("data-welcome-highlight")).toBeNull();
    expect(row.className).not.toContain("ring-ih-primary");
  });

  it("dismissing the banner hides it", async () => {
    const { findByText, getByLabelText, queryByText } = renderDashboard({
      referrals: [REFERRAL_I1],
      welcomeInspectionId: "i1",
    });

    await findByText("Welcome! Here's the inspection you were just added to.");
    fireEvent.click(getByLabelText("Dismiss"));

    expect(
      queryByText("Welcome! Here's the inspection you were just added to."),
    ).toBeNull();
  });
});
