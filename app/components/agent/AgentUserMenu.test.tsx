// @vitest-environment happy-dom
/**
 * The agent portal's account menu.
 *
 * Audited 2026-09-10: no page of this portal showed who was signed in — no name,
 * no email, no avatar, no role — only a bare `Log out`. Stacked on F69 (any
 * signed-in session was admitted) that was the reason a wrongly-admitted
 * inspector had nothing on screen to tell them whose portal they were in.
 *
 * So the role is asserted here as hard as the identity is: it is the field that
 * makes the audience legible.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AgentUserMenu, type AgentPortalAccount } from "./AgentUserMenu";

const JANE: AgentPortalAccount = { name: "Jane Agent", email: "jane@realty.test" };

function renderMenu(account: AgentPortalAccount | null) {
  const Stub = createRoutesStub([
    { path: "/agent-dashboard", Component: () => <AgentUserMenu account={account} /> },
    { path: "/agent-settings/profile", Component: () => <p>profile page</p> },
  ]);
  return render(<Stub initialEntries={["/agent-dashboard"]} />);
}

describe("AgentUserMenu", () => {
  it("names who is signed in without being opened", () => {
    const { getByTestId } = renderMenu(JANE);
    expect(getByTestId("agent-user-menu-trigger").textContent).toContain("Jane Agent");
  });

  it("shows the email and the ROLE once opened", () => {
    const { getByTestId, getByText } = renderMenu(JANE);
    fireEvent.click(getByTestId("agent-user-menu-trigger"));
    expect(getByText("jane@realty.test")).toBeTruthy();
    // The role, because being in the wrong portal was possible at all.
    expect(getByText("Agent")).toBeTruthy();
  });

  it("carries the account exits: profile and log out", () => {
    const { getByTestId, getByText } = renderMenu(JANE);
    fireEvent.click(getByTestId("agent-user-menu-trigger"));
    expect(getByText("My profile").getAttribute("href")).toBe("/agent-settings/profile");
    // The agent door's teardown, not `/logout` — which would land an agent on the
    // staff sign-in they cannot use (see loginPathFor in session.server.ts).
    expect(getByTestId("agent-user-menu-logout").getAttribute("href")).toBe("/agent-logout");
  });

  it("carries the theme control, which the header only offered at md and up", () => {
    const { getByTestId, getByText } = renderMenu(JANE);
    fireEvent.click(getByTestId("agent-user-menu-trigger"));
    expect(getByText("Theme")).toBeTruthy();
  });

  it("is closed until it is opened (the panel is not merely hidden)", () => {
    const { queryByText, getByTestId } = renderMenu(JANE);
    expect(queryByText("jane@realty.test")).toBeNull();
    expect(getByTestId("agent-user-menu-trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("falls back to the email when the account has no name", () => {
    const { getByTestId } = renderMenu({ name: null, email: "jane@realty.test" });
    expect(getByTestId("agent-user-menu-trigger").textContent).toContain("jane@realty.test");
  });

  it("still works when the profile row could not be read at all", () => {
    // A 404 from the profile route is a broken record, not the wrong audience, so
    // the portal stays reachable — with the role, and with the way out that the
    // bare `Log out` at least got right.
    const { getByTestId } = renderMenu(null);
    expect(getByTestId("agent-user-menu-trigger").textContent).toContain("Agent");
    fireEvent.click(getByTestId("agent-user-menu-trigger"));
    expect(getByTestId("agent-user-menu-logout")).toBeTruthy();
  });
});
