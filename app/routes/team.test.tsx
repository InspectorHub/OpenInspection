// @vitest-environment happy-dom
/**
 * `/team` — the third entrance to the import wizard.
 *
 * Templates and contacts each had an importer of their own to replace. Team
 * had none: bringing a roster over meant typing every address into the invite
 * drawer one at a time, and `members.invite` — an intent with a server, a seat
 * pre-check and tests — was reachable from nowhere. That is the same defect as
 * a guessing modal, only quieter: a capability nobody can find.
 *
 * What is pinned here:
 *
 *   1. the entrance exists and resolves to the wizard's `members.invite` entry
 *      — asserted as a set, so a second control added later cannot point
 *      somewhere else while this stays green;
 *   2. INVITE is still a button. The bulk entrance sits beside it, and a page
 *      that turned the wrong one into a link would satisfy (1);
 *   3. the two are ordered secondary-then-primary, the order `/contacts` and
 *      `/templates` already use. Read off the DOM rather than from a class
 *      name, because a class is what a header looks like and this is about
 *      which control comes first.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import TeamPage from "~/routes/team";

const FRONT_DOOR = "/settings/imports?intent=members.invite";

function renderTeam(loaderData: Record<string, unknown>) {
  const Stub = createRoutesStub([
    { path: "/team", Component: TeamPage, loader: () => loaderData },
  ]);
  return render(<Stub initialEntries={["/team"]} />);
}

const BASE = { members: [], canManage: true, loadFailed: false };

describe("/team — the bulk entrance", () => {
  it("offers an import entrance that resolves to the wizard", async () => {
    renderTeam(BASE);
    await screen.findByRole("button", { name: /Invite Member/i });

    const links = screen.getAllByRole("link", { name: /import/i });
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(
      new Set([FRONT_DOOR]),
    );
  });

  it("keeps INVITE a button — the control that must NOT have become a link", async () => {
    renderTeam(BASE);

    const invite = await screen.findByRole("button", { name: /Invite Member/i });
    expect(invite.tagName).toBe("BUTTON");
    expect(screen.queryByRole("link", { name: /Invite Member/i })).toBeNull();
  });

  it("puts the secondary entrance before the primary one", async () => {
    const { container } = renderTeam(BASE);
    const invite = await screen.findByRole("button", { name: /Invite Member/i });
    const importLink = screen.getAllByRole("link", { name: /import/i })[0];

    // DOCUMENT_POSITION_FOLLOWING — the import link comes first in the DOM,
    // which is what "secondary on the left" means to a screen reader and to a
    // keyboard, not only to the eye.
    expect(
      importLink.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Positive control: both really are in this page, not in some detached
    // fragment where every position comparison is meaningless.
    expect(container.contains(importLink)).toBe(true);
    expect(container.contains(invite)).toBe(true);
  });
});
