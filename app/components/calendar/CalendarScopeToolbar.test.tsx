// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { CalendarScopeToolbar } from "./CalendarScopeToolbar";
import { defaultCalendarScope } from "./calendar-helpers";

/**
 * The toolbar now reads the viewer's RESOLVED capabilities (for the Dispatch
 * cross-link), so it needs a data router with an auth-layout loader around it —
 * rendered bare it throws before any assertion runs. The router hydrates
 * asynchronously, which is why every assertion here waits.
 */
function renderToolbar(
  ui: React.ReactElement,
  capabilities: Record<string, boolean> | null = null,
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      id: "routes/auth-layout",
      loader: () => (capabilities ? { context: { user: { capabilities } } } : { context: null }),
      Component: () => ui,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const BASE = {
  members: [],
  selectedUserIds: [],
  onScopeChange: vi.fn(),
  onToggleMember: vi.fn(),
  locale: "en-US",
};

describe("CalendarScopeToolbar", () => {
  it("defaults Team for owner", async () => {
    const scope = defaultCalendarScope("owner");
    renderToolbar(<CalendarScopeToolbar {...BASE} scope={scope} role="owner" />);

    expect(scope).toBe("team");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Team" }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByRole("button", { name: "My" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("defaults My for inspector and hides Team", async () => {
    const scope = defaultCalendarScope("inspector");
    renderToolbar(<CalendarScopeToolbar {...BASE} scope={scope} role="inspector" />);

    expect(scope).toBe("my");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "My" }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.queryByRole("button", { name: "Team" })).toBeNull();
  });

  it("shows inspector chips in Team mode for managers", async () => {
    renderToolbar(
      <CalendarScopeToolbar
        {...BASE}
        scope="team"
        role="manager"
        members={[
          { id: "u1", name: "Alex", email: "alex@example.com", role: "inspector" },
          { id: "u2", name: "Sam", email: "sam@example.com", role: "inspector" },
        ]}
        selectedUserIds={["u1"]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Alex" }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByRole("button", { name: "Sam" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("offers Dispatch only to a viewer who holds scheduleOthers", async () => {
    // A manager whose override was revoked: the role tier says yes, the
    // capability says no, and /calendar/dispatch would redirect them back.
    renderToolbar(
      <CalendarScopeToolbar {...BASE} scope="team" role="manager" />,
      { scheduleOthers: false },
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Team" })).toBeTruthy());
    expect(screen.queryByTestId("calendar-open-dispatch")).toBeNull();

    renderToolbar(
      <CalendarScopeToolbar {...BASE} scope="team" role="manager" />,
      { scheduleOthers: true },
    );
    expect(await screen.findByTestId("calendar-open-dispatch")).toBeTruthy();
  });

  it("keeps the cross-link out of My mode", async () => {
    renderToolbar(
      <CalendarScopeToolbar {...BASE} scope="my" role="manager" />,
      { scheduleOthers: true },
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "My" })).toBeTruthy());
    expect(screen.queryByTestId("calendar-open-dispatch")).toBeNull();
  });

  it("shows sync freshness beside each Team chip", async () => {
    const now = Date.UTC(2026, 7, 3, 12, 0, 0);
    const { container } = renderToolbar(
      <CalendarScopeToolbar
        {...BASE}
        scope="team"
        role="manager"
        members={[
          {
            id: "u1", name: "Alex", email: "alex@example.com", role: "inspector",
            calendarConnected: true, calendarLastSyncAt: now - 3_600_000,
          },
          {
            id: "u2", name: "Sam", email: "sam@example.com", role: "inspector",
            calendarConnected: true, calendarLastSyncAt: now - 30 * 3_600_000,
          },
          {
            id: "u3", name: "Jo", email: "jo@example.com", role: "inspector",
            calendarConnected: false, calendarLastSyncAt: null,
          },
        ]}
        selectedUserIds={["u1"]}
        now={now}
      />,
    );

    await waitFor(() => {
      const states = [...container.querySelectorAll("[data-sync-state]")]
        .map((el) => el.getAttribute("data-sync-state"));
      expect(states).toEqual(["connected", "stale", "not-connected"]);
    });
  });
});
