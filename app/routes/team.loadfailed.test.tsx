// @vitest-environment happy-dom
/**
 * A failed roster fetch must not answer "nobody is here", and must not quietly
 * take away permissions it already knows the caller has (IA-118).
 *
 * The loader caught any failure into `{ members: [], canManage: false }`. Two
 * false claims in one line:
 *
 *   1. An empty roster is a statement about who can reach this workspace. The
 *      same shape told an operator a contact "cannot open any reports" while
 *      they held two live links.
 *   2. `canManage` is derived from the JWT role, resolved BEFORE the request
 *      that failed. Returning false downgraded an owner because a list did not
 *      load — and the page hides the manage affordances, so it reads as "you are
 *      not allowed" rather than "this did not load".
 *
 * `res.ok === false` also used to fall through to the same empty shape as
 * success, so a 500 and a genuinely empty team were indistinguishable.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import TeamPage from "~/routes/team";

function renderTeam(loaderData: Record<string, unknown>) {
  const Stub = createRoutesStub([
    { path: "/team", Component: TeamPage, loader: () => loaderData },
  ]);
  return render(<Stub initialEntries={["/team"]} />);
}

const BASE = { members: [], canManage: true, loadFailed: false };

describe("team page — a failed load is not an empty team", () => {
  it("says the list may be incomplete when the fetch failed", async () => {
    const { findByText } = renderTeam({ ...BASE, loadFailed: true });
    expect(await findByText(/could not be loaded/i)).toBeTruthy();
  });

  it("stays quiet when the team is genuinely empty", async () => {
    const { queryByText, findByText } = renderTeam(BASE);
    // Anchor on a control that renders once, not on the word "Team" which
    // appears in the crumb, the heading and the nav.
    await findByText(/Invite Member/i);
    expect(queryByText(/could not be loaded/i)).toBeNull();
  });

  it("keeps the caller's manage rights through a failed load", async () => {
    // The regression: an owner must still be offered Invite Member. Their role
    // came from the JWT and was never in question.
    const { findByText } = renderTeam({ ...BASE, loadFailed: true, canManage: true });
    expect(await findByText(/Invite Member/i)).toBeTruthy();
  });
});
