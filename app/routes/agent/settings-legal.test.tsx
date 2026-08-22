// @vitest-environment happy-dom
/**
 * What an agent accepted, what it said, and — the part no row of data can state
 * — what these terms do NOT cover.
 *
 * The list is a table and tests itself. The paragraph about report links is the
 * reason the page exists: an agent who both holds an account here and opens
 * reports through links inspectors share will otherwise read this page as the
 * complete account of why they can see anything. It is not, and the mechanism
 * says so plainly — a report link is an `inspection_access_tokens` bearer, the
 * JWT middleware short-circuits before classification, and the agent-terms gate
 * never runs on that request at all.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import AgentSettingsLegalPage from "~/routes/agent/settings-legal";
import type { AcceptanceRow } from "~/routes/agent/settings-legal";

const AVAILABLE: AcceptanceRow = {
  version: "2026-08-02",
  contentHash: "b".repeat(64),
  acceptedAt: Date.UTC(2026, 7, 2, 15, 4),
  bodyAvailable: true,
  body: "The second agent terms.",
};

const OLDER: AcceptanceRow = {
  version: "2026-08-01",
  contentHash: "a".repeat(64),
  acceptedAt: Date.UTC(2026, 7, 1, 9, 30),
  bodyAvailable: true,
  body: "The first agent terms.",
};

const UNARCHIVED: AcceptanceRow = {
  version: "2026-07-01",
  contentHash: "c".repeat(64),
  acceptedAt: Date.UTC(2026, 6, 1, 9, 30),
  bodyAvailable: false,
  body: null,
};

function renderPage(acceptances: AcceptanceRow[], loadFailed = false) {
  const Stub = createRoutesStub([
    {
      path: "/agent-settings/legal",
      Component: AgentSettingsLegalPage,
      loader: () => ({ acceptances, loadFailed }),
    },
  ]);
  return render(<Stub initialEntries={["/agent-settings/legal"]} />);
}

describe("AgentSettingsLegalPage", () => {
  it("lists each acceptance with its version and date, newest first", async () => {
    renderPage([AVAILABLE, OLDER]);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText(/2026-08-02/)).toBeTruthy();
    expect(within(items[1]!).getByText(/2026-08-01/)).toBeTruthy();
    // The date is rendered, not just the version string. A record of "which
    // document" with no "when" is half an answer.
    expect(within(items[0]!).getByText(/Aug/)).toBeTruthy();
  });

  it("links to the text of a version whose body is still published", async () => {
    renderPage([AVAILABLE, OLDER]);
    const items = await screen.findAllByRole("listitem");
    const link = within(items[1]!).getByRole("link");
    // Each link points at THAT version's archived text, keyed on the content
    // hash the acceptance names — never at a shared "current document" target.
    expect(link.getAttribute("href")).toBe(`#agent-terms-${OLDER.contentHash}`);
    // And the text it points at is on the page, under that id.
    const region = document.getElementById(`agent-terms-${OLDER.contentHash}`);
    expect(region?.textContent).toContain("The first agent terms.");
  });

  // Substituting today's document for an unarchived one would show the agent
  // something they never agreed to, which is the failure this page exists to end.
  it("says the text is unavailable rather than linking to the current version", async () => {
    renderPage([AVAILABLE, UNARCHIVED]);
    const items = await screen.findAllByRole("listitem");
    const unarchived = items.find((li) => li.textContent?.includes("2026-07-01"))!;
    expect(within(unarchived).queryByRole("link")).toBeNull();
    expect(within(unarchived).getByText(/no longer archived|not archived/i)).toBeTruthy();
    // The positive control in the same render: the row that CAN be read still
    // links. A page that had simply stopped rendering links would satisfy the
    // assertion above on its own.
    const readable = items.find((li) => li.textContent?.includes("2026-08-02"))!;
    expect(within(readable).getByRole("link")).toBeTruthy();
    // And the current text is nowhere near the unavailable row.
    expect(unarchived.textContent).not.toContain("The second agent terms.");
  });

  // The paragraph is load-bearing. Without it, an agent who uses both routes
  // concludes their report access flows from these terms. It does not.
  it("states that report-link access comes from a different agreement", async () => {
    renderPage([AVAILABLE]);
    await screen.findAllByRole("listitem");
    expect(
      screen.getByText(/different agreement|inspection company and its client/i),
    ).toBeTruthy();
  });

  it("says the same thing when the list is empty — the paragraph is not a footnote on the data", async () => {
    renderPage([]);
    expect(
      await screen.findByText(/different agreement|inspection company and its client/i),
    ).toBeTruthy();
  });

  // On a deployment that has published nothing, this page is EMPTY and correct.
  // Without this copy it reads as broken.
  it("explains an empty list as 'this deployment has published no agent terms'", async () => {
    renderPage([]);
    expect(await screen.findByText(/has not published/i)).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  // An empty list and a failed read are different facts, and only one of them
  // is the deployment's normal state. Telling a reader "nothing published"
  // after a read that never answered would be a false statement about the
  // operator, produced by an outage.
  it("distinguishes a failed read from an empty record", async () => {
    renderPage([], true);
    expect(await screen.findByText(/could not be loaded|try again/i)).toBeTruthy();
    expect(screen.queryByText(/has not published/i)).toBeNull();
  });

  it("says nothing about how the agent signed in", async () => {
    renderPage([AVAILABLE, OLDER]);
    await screen.findAllByRole("listitem");
    // Signup, password login and the emailed magic link mint byte-identical
    // JWTs; the middleware sets `agentUserId` from the classification alone and
    // cannot tell them apart. Copy that named a sign-in method would be an
    // invention, and the same document is accepted through all three.
    expect(document.body.textContent).not.toMatch(/magic link|signed in with|password login/i);
  });
});
