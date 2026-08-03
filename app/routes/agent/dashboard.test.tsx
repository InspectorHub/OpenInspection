// @vitest-environment happy-dom
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
import { createRoutesStub, Outlet } from "react-router";

import AgentDashboardPage from "~/routes/agent/dashboard";

const REFERRAL_I1 = {
  id: "i1",
  repairAccess: "readwrite" as const,
  tenantName: "Acme Inspections",
  tenantSlug: "acme",
  tenantTimezone: "UTC",
  propertyAddress: "123 Main St",
  clientName: "Jane Client",
  date: "2026-07-18",
  status: "delivered",
  reportStatus: "published",
  inspectorName: "Bob Inspector",
};

const REFERRAL_I2 = {
  id: "i2",
  repairAccess: "readwrite" as const,
  tenantName: "Acme Inspections",
  tenantSlug: "acme",
  tenantTimezone: "UTC",
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
  agentTimezone?: string | null;
}) {
  // Nest the dashboard under a route carrying the agent-layout id so
  // useAgentTimeZoneOverride() resolves from a real loader (the agent-portal
  // analogue of useSessionContext). Without a match it falls back to null.
  const Stub = createRoutesStub([
    {
      id: "routes/agent-layout",
      path: "/",
      Component: () => <Outlet />,
      loader: () => ({ agentTimezone: opts.agentTimezone ?? null }),
      children: [
        {
          path: "agent-dashboard",
          Component: AgentDashboardPage,
          loader: () => ({
            referrals: opts.referrals ?? [],
            unreadReports: opts.unreadReports ?? 0,
            welcomeInspectionId: opts.welcomeInspectionId ?? null,
          }),
        },
      ],
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

  it("humanizes the referral date through the shared formatter (never a raw ISO timestamp)", async () => {
    const { findByTestId } = renderDashboard({
      referrals: [{ ...REFERRAL_I1, id: "i3", tenantTimezone: "UTC", date: "2026-07-20T00:27:12.605Z" }],
      welcomeInspectionId: null,
    });

    const row = await findByTestId("referral-row-i3");
    // Rendered via formatInspectionDateTime: month-abbrev date, never the raw
    // ISO string, with a short zone label so the time reads unambiguously.
    expect(row.textContent).toContain("Jul 20");
    expect(row.textContent).not.toContain("2026-07-20T00:27:12");
    expect(row.textContent).toContain("UTC");
  });

  it("renders each referral date in its OWNING TENANT's timezone when the agent has no override", async () => {
    const { findByTestId } = renderDashboard({
      // Same instant, two different owning-tenant zones -> two different labels.
      referrals: [
        { ...REFERRAL_I1, id: "utc", tenantTimezone: "UTC", date: "2026-07-20T12:00:00Z" },
        { ...REFERRAL_I1, id: "la", tenantTimezone: "America/Los_Angeles", date: "2026-07-20T12:00:00Z" },
      ],
      agentTimezone: null,
    });

    expect((await findByTestId("referral-row-utc")).textContent).toContain("UTC");
    // 12:00Z is 05:00 PDT — the owning tenant's zone label, not UTC.
    expect((await findByTestId("referral-row-la")).textContent).toContain("PDT");
  });

  it("applies the agent's personal timezone override to EVERY row, over each tenant's zone", async () => {
    const { findByTestId } = renderDashboard({
      referrals: [
        { ...REFERRAL_I1, id: "utc", tenantTimezone: "UTC", date: "2026-07-20T12:00:00Z" },
        { ...REFERRAL_I1, id: "la", tenantTimezone: "America/Los_Angeles", date: "2026-07-20T12:00:00Z" },
      ],
      agentTimezone: "America/New_York",
    });

    // Both rows render in the agent's chosen zone (EDT), ignoring the per-row
    // tenant tz — 12:00Z is 08:00 EDT.
    expect((await findByTestId("referral-row-utc")).textContent).toContain("EDT");
    expect((await findByTestId("referral-row-la")).textContent).toContain("EDT");
  });

  it("shows a plain date (no time/zone) for a calendar-only YYYY-MM-DD date, even with an override", async () => {
    // inspections.date is a mixed column; an explicit date-only value is anchored
    // to UTC by formatInspectionDateTime and shown without a time — so no zone
    // label appears and the resolved tz has no visible effect (avoids rollover).
    const { findByTestId } = renderDashboard({
      referrals: [{ ...REFERRAL_I1, id: "dateonly", tenantTimezone: "America/Los_Angeles", date: "2026-07-18" }],
      agentTimezone: "America/New_York",
    });
    const row = await findByTestId("referral-row-dateonly");
    expect(row.textContent).toContain("Jul 18");
    expect(row.textContent).not.toMatch(/EDT|PDT|PST|UTC|AM|PM/);
  });
});

describe("AgentDashboardPage property/transaction grouping (IA-51)", () => {
  it("groups two same-address referrals from different companies into ONE section of two rows", async () => {
    const { findByTestId, getAllByText, queryByText } = renderDashboard({
      referrals: [
        { ...REFERRAL_I1, id: "acme", tenantName: "Acme Inspections", propertyAddress: "123 Main St", date: "2026-07-18" },
        // Same property, different company + casing/whitespace — must collapse.
        { ...REFERRAL_I1, id: "best", tenantName: "Best Inspect", propertyAddress: "123  main st ", date: "2026-07-12" },
      ],
      welcomeInspectionId: "best",
    });

    // Both referrals render as rows inside one section...
    const acme = await findByTestId("referral-row-acme");
    const best = await findByTestId("referral-row-best");
    // The address appears exactly once — as the single group header, NOT once
    // per company section (the old behavior was two sections).
    expect(getAllByText("123 Main St")).toHaveLength(1);
    // ...and the company name is now inline row metadata, not the header.
    expect(acme.textContent).toContain("Acme Inspections");
    expect(best.textContent).toContain("Best Inspect");
    // The ?welcome row stays highlighted even after the merge.
    expect(best.getAttribute("data-welcome-highlight")).toBe("true");
    // There is no company section header anymore.
    expect(queryByText("Acme Inspections", { selector: "span.text-sm" })).toBeNull();
  });

  it("uses the property address as the section header and the company as an inline row label", async () => {
    const { getByText, findByTestId } = renderDashboard({
      referrals: [{ ...REFERRAL_I1, id: "one", tenantName: "Acme Inspections", propertyAddress: "789 Pine Rd" }],
    });
    // Row leads with the company (the vendor on this deal), demoted from header.
    const row = await findByTestId("referral-row-one");
    expect(row.textContent).toContain("Acme Inspections");
    // Header = address.
    expect(getByText("789 Pine Rd")).toBeTruthy();
  });

  it("filters referrals to a single company via the secondary company dropdown", async () => {
    const { getByLabelText, findByTestId, queryByTestId } = renderDashboard({
      referrals: [
        { ...REFERRAL_I1, id: "acme", tenantName: "Acme Inspections", propertyAddress: "123 Main St" },
        { ...REFERRAL_I2, id: "best", tenantName: "Best Inspect", propertyAddress: "456 Oak Ave" },
      ],
    });
    // Both visible initially.
    await findByTestId("referral-row-acme");
    await findByTestId("referral-row-best");

    const filter = getByLabelText("Filter referrals by company") as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "Best Inspect" } });

    expect(queryByTestId("referral-row-acme")).toBeNull();
    expect(queryByTestId("referral-row-best")).toBeTruthy();
  });

  it("hides the company filter when the agent partners with only one company", async () => {
    const { queryByLabelText, findByTestId } = renderDashboard({
      referrals: [
        { ...REFERRAL_I1, id: "a", tenantName: "Acme Inspections", propertyAddress: "1 A St" },
        { ...REFERRAL_I2, id: "b", tenantName: "Acme Inspections", propertyAddress: "2 B St" },
      ],
    });
    await findByTestId("referral-row-a");
    expect(queryByLabelText("Filter referrals by company")).toBeNull();
  });
});

describe("AgentDashboardPage respects the company's agent repair policy (IA-35)", () => {
  it("offers the repair builder when the company allows agents to build lists", async () => {
    const { findByTestId } = renderDashboard({
      referrals: [{ ...REFERRAL_I1, repairAccess: "readwrite" }],
    });
    const row = await findByTestId("referral-row-i1");
    expect(row.textContent).toContain("Build repair request");
  });

  it("hides it when the company turned agent access off — the API would refuse anyway", async () => {
    const { findByTestId } = renderDashboard({
      referrals: [{ ...REFERRAL_I1, repairAccess: "off" }],
    });
    const row = await findByTestId("referral-row-i1");
    expect(row.textContent).not.toContain("Build repair request");
  });

  it("still links a read-only agent to the list they may open", async () => {
    const { findByTestId } = renderDashboard({
      referrals: [{ ...REFERRAL_I1, repairAccess: "read" }],
    });
    const row = await findByTestId("referral-row-i1");
    expect(row.textContent).toContain("Build repair request");
  });
});
