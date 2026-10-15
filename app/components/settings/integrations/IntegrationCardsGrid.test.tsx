// @vitest-environment happy-dom
/**
 * The hub draws what the overview API says and nothing it invented.
 *
 * It used to hold a hard-coded list: Resend read "Connected" for every company
 * whatever was stored, and Zapier sat there as a card that did nothing. These
 * specs feed it cards and read back what a person sees.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { IntegrationCardsGrid } from "./IntegrationCardsGrid";
import type { IntegrationCard } from "../../../../server/lib/integrations/overview";

afterEach(cleanup);

const CARDS: IntegrationCard[] = [
  { id: "stripe", category: "payments", status: "connected", source: "own", canUseOwn: false, detailPath: "/settings/integrations#stripe", reasonKey: null },
  { id: "quickbooks", category: "accounting", status: "attention", source: "provided", canUseOwn: false, detailPath: "/settings/integrations/qbo", reasonKey: null },
  { id: "googleCalendar", category: "calendar", status: "not_connected", source: "provided", canUseOwn: false, detailPath: "/settings/schedule", reasonKey: null },
  { id: "email", category: "messaging", status: "not_connected", source: "own", canUseOwn: true, detailPath: "/settings/communication", reasonKey: null },
  {
    id: "sms", category: "messaging", status: "not_connected", source: "unavailable", canUseOwn: true,
    detailPath: "/settings/communication", reasonKey: "integrations_source_reason_provider_confirmation_pending",
  },
  { id: "places", category: "data", status: "connected", source: "provided", canUseOwn: false, detailPath: "/settings/advanced", reasonKey: null },
  { id: "estated", category: "data", status: "not_connected", source: "unavailable", canUseOwn: false, detailPath: "/settings/advanced", reasonKey: null },
  { id: "video", category: "video", status: "connected", source: "provided", canUseOwn: false, detailPath: "/settings/integrations", reasonKey: null },
  { id: "ai", category: "ai", status: "connected", source: "own", canUseOwn: true, detailPath: "/settings/advanced", reasonKey: null },
];

function renderGrid(cards: IntegrationCard[]) {
  const Stub = createRoutesStub([{ path: "/", Component: () => <IntegrationCardsGrid cards={cards} /> }]);
  return render(<Stub initialEntries={["/"]} />);
}
const cardOf = (title: string) => screen.getByRole("article", { name: title });

describe("IntegrationCardsGrid", () => {
  it("groups by category in the design order", async () => {
    renderGrid(CARDS);
    await screen.findByText("Card payments");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Payments", "Accounting", "Calendar", "Messaging", "Address and property data", "Video", "AI",
    ]);
  });

  it("draws one card per overview entry and none for a service the API did not return", async () => {
    renderGrid(CARDS.filter((c) => c.id !== "estated"));
    await screen.findByText("Card payments");
    expect(screen.getAllByRole("article")).toHaveLength(CARDS.length - 1);
    expect(screen.queryByText("Property facts")).toBeNull();
    // the old hard-coded list always drew this one
    expect(screen.queryByText(/zapier/i)).toBeNull();
    // a category with no cards draws no heading
    cleanup();
    renderGrid(CARDS.filter((c) => c.category !== "video"));
    await screen.findByText("Card payments");
    expect(screen.queryByRole("heading", { level: 2, name: "Video" })).toBeNull();
  });

  it("states the source on every card, apart from the status", async () => {
    renderGrid(CARDS);
    await screen.findByText("Card payments");
    expect(within(cardOf("Card payments")).getByText("Your own")).toBeTruthy();
    expect(within(cardOf("Accounting")).getByText("Built-in")).toBeTruthy();
    // an unavailable source says why, in words, never a bare "unavailable"
    expect(within(cardOf("SMS")).getByText("Built-in SMS is not available yet. Use Your own account to send SMS.")).toBeTruthy();
    for (const card of screen.getAllByRole("article")) {
      expect(within(card).getAllByTestId("integration-source")).toHaveLength(1);
      expect(within(card).getAllByTestId("integration-status")).toHaveLength(1);
    }
  });

  it("takes the email status from the API, not from a constant", async () => {
    renderGrid(CARDS);
    await screen.findByText("Card payments");
    expect(within(cardOf("Email")).getByTestId("integration-status").textContent).toBe("Not connected");
    cleanup();
    renderGrid(CARDS.map((c) => (c.id === "email" ? { ...c, status: "connected" as const } : c)));
    await screen.findByText("Card payments");
    expect(within(cardOf("Email")).getByTestId("integration-status").textContent).toBe("Connected");
  });

  it("names the three statuses and links each card to its page with a verb that follows the status", async () => {
    renderGrid(CARDS);
    await screen.findByText("Card payments");
    expect(within(cardOf("Accounting")).getByTestId("integration-status").textContent).toBe("Needs attention");
    const manage = within(cardOf("Card payments")).getByRole("link", { name: "Manage: Card payments" });
    expect(manage.getAttribute("href")).toBe("/settings/integrations#stripe");
    expect(within(cardOf("Email")).getByRole("link", { name: "Set up: Email" }).getAttribute("href")).toBe("/settings/communication");
    expect(within(cardOf("Accounting")).getByRole("link", { name: "Review items: Accounting" }).getAttribute("href")).toBe("/settings/integrations/qbo");
    // Google Calendar goes to Schedule, where each person signs in
    expect(within(cardOf("Calendar")).getByRole("link", { name: "Set up: Calendar" }).getAttribute("href")).toBe("/settings/schedule");
  });

  it("gives every card exactly one action, primary only where something needs doing, and at most two columns", async () => {
    const { container } = renderGrid(CARDS);
    await screen.findByText("Card payments");
    for (const card of screen.getAllByRole("article")) {
      expect(within(card).getAllByRole("link")).toHaveLength(1);
    }
    const manage = within(cardOf("Card payments")).getByRole("link");
    const setUp = within(cardOf("Email")).getByRole("link");
    expect(manage.className).toContain("text-ih-primary-text");
    expect(manage.className).not.toContain("bg-ih-primary ");
    expect(setUp.className).toContain("bg-ih-primary");
    for (const grid of container.querySelectorAll("section > div")) {
      expect(grid.className).toContain("md:grid-cols-2");
      expect(grid.className).not.toContain("lg:grid-cols-3");
    }
  });

  it("counts the statuses at the top", async () => {
    renderGrid(CARDS);
    await screen.findByText("Card payments");
    const summary = screen.getByLabelText("Integration status summary");
    expect(summary.textContent).toContain("4 connected");
    expect(summary.textContent).toContain("1 need attention");
    expect(summary.textContent).toContain("4 not connected");
  });

  it("explains Built-in only when some service can be built in", async () => {
    renderGrid(CARDS);
    await screen.findByText("Card payments");
    expect(screen.getByText(/Built-in: included and ready/)).toBeTruthy();
    cleanup();
    renderGrid(CARDS.map((c) => ({ ...c, source: "own" as const, canUseOwn: false })));
    await screen.findByText("Card payments");
    expect(screen.queryByText(/Built-in: included and ready/)).toBeNull();
    expect(screen.getByText(/Status: whether the service is working/)).toBeTruthy();
  });

  it("never shows internal vocabulary", async () => {
    const { container } = renderGrid(CARDS);
    await screen.findByText("Card payments");
    expect(container.textContent).not.toMatch(/workspace|tenant|deployment|platform|managed|byo/i);
  });

  it("says so when there is nothing to show", async () => {
    renderGrid([]);
    expect(await screen.findByText("There are no integrations to show.")).toBeTruthy();
  });
});
