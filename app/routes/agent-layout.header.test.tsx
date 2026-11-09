// @vitest-environment happy-dom
/**
 * The agent portal header at phone width.
 *
 * Measured at 390 px on every agent page: the single non-wrapping flex row was
 * 606 px wide inside a 375 px viewport, so the nav items were cut and the notices
 * bell and the account menu sat off-screen. The fix is structural, and these
 * assertions pin the structure rather than a pixel width (happy-dom lays nothing
 * out): the header row may wrap; the nav takes its own full-width row below the
 * brand on a phone and scrolls horizontally inside itself; the bell and the
 * account menu live OUTSIDE that scroll container so they can never be scrolled
 * away; from `md` up everything is one row again.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn() }));
vi.mock("~/lib/api-client.server", () => ({ createApi: vi.fn() }));
vi.mock("~/components/agent/AgentNoticeBell", () => ({
  AgentNoticeBell: () => <button type="button" aria-label="bell-probe" />,
}));
vi.mock("~/components/agent/AgentUserMenu", () => ({
  AgentUserMenu: () => <button type="button" aria-label="menu-probe" />,
}));

import AgentLayout from "~/routes/agent-layout";

// The route's generated props are not worth building by hand: only `loaderData` is read.
const layoutProps: Parameters<typeof AgentLayout>[0] = {
  loaderData: { agentTimezone: null, notices: { notices: [], unread: 0 }, account: null },
} as never;

function renderLayout(path = "/agent-dashboard") {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <AgentLayout {...layoutProps} />
      ),
      children: [
        { path: "agent-dashboard", Component: () => <p>dash</p> },
        { path: "agent-inspectors", Component: () => <p>insp</p> },
      ],
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe("agent portal header — phone width", () => {
  it("lets the header row wrap instead of forcing one 606px line", async () => {
    renderLayout();
    const header = (await screen.findByRole("banner")) as HTMLElement;
    expect(header.firstElementChild?.className).toMatch(/\bflex-wrap\b/);
  });

  it("gives the nav its own full-width row on a phone, scrolling inside itself", async () => {
    renderLayout();
    const nav = await screen.findByRole("navigation");
    expect(nav.className).toMatch(/\boverflow-x-auto\b/);
    expect(nav.className).toMatch(/\bw-full\b/);
    expect(nav.className).toMatch(/\border-last\b/);
    // Back to one row from md up.
    expect(nav.className).toMatch(/\bmd:w-auto\b/);
    expect(nav.className).toMatch(/\bmd:order-none\b/);
  });

  it("keeps every nav item on one line and unshrunk so the row scrolls, not squashes", async () => {
    renderLayout();
    const nav = await screen.findByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link.className).toMatch(/\bshrink-0\b/);
      expect(link.className).toMatch(/\bwhitespace-nowrap\b/);
    }
  });

  it("keeps the bell and the account menu outside the scrolling nav, so they stay on screen", async () => {
    renderLayout();
    const nav = await screen.findByRole("navigation");
    expect(within(nav).queryByLabelText("bell-probe")).toBeNull();
    expect(within(nav).queryByLabelText("menu-probe")).toBeNull();
    // The positive control: they are on the page, in the header.
    const header = screen.getByRole("banner");
    expect(within(header).getByLabelText("bell-probe")).toBeTruthy();
    expect(within(header).getByLabelText("menu-probe")).toBeTruthy();
  });

  it("names the nav landmark and marks the current page", async () => {
    renderLayout("/agent-inspectors");
    const nav = await screen.findByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBeTruthy();
    const current = within(nav).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("href")).toBe("/agent-inspectors");
  });
});
