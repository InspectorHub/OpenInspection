import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CalendarScopeToolbar } from "./CalendarScopeToolbar";
import { defaultCalendarScope } from "./calendar-helpers";

describe("CalendarScopeToolbar", () => {
  it("defaults Team for owner", () => {
    const scope = defaultCalendarScope("owner");
    const { getByRole } = render(
      <CalendarScopeToolbar
        scope={scope}
        role="owner"
        members={[]}
        selectedUserIds={[]}
        onScopeChange={vi.fn()}
        onToggleMember={vi.fn()}
        locale="en-US"
      />,
    );

    expect(scope).toBe("team");
    expect(getByRole("button", { name: "Team" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "My" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("defaults My for inspector and hides Team", () => {
    const scope = defaultCalendarScope("inspector");
    const { getByRole, queryByRole } = render(
      <CalendarScopeToolbar
        scope={scope}
        role="inspector"
        members={[]}
        selectedUserIds={[]}
        onScopeChange={vi.fn()}
        onToggleMember={vi.fn()}
        locale="en-US"
      />,
    );

    expect(scope).toBe("my");
    expect(getByRole("button", { name: "My" }).getAttribute("aria-pressed")).toBe("true");
    expect(queryByRole("button", { name: "Team" })).toBeNull();
  });

  it("shows inspector chips in Team mode for managers", () => {
    const { getByRole } = render(
      <CalendarScopeToolbar
        scope="team"
        role="manager"
        members={[
          { id: "u1", name: "Alex", email: "alex@example.com", role: "inspector" },
          { id: "u2", name: "Sam", email: "sam@example.com", role: "inspector" },
        ]}
        selectedUserIds={["u1"]}
        onScopeChange={vi.fn()}
        onToggleMember={vi.fn()}
        locale="en-US"
      />,
    );

    expect(getByRole("button", { name: "Alex" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "Sam" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows sync freshness beside each Team chip", () => {
    const now = Date.UTC(2026, 7, 3, 12, 0, 0);
    const { container } = render(
      <CalendarScopeToolbar
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
        onScopeChange={vi.fn()}
        onToggleMember={vi.fn()}
        locale="en-US"
        now={now}
      />,
    );

    const states = [...container.querySelectorAll("[data-sync-state]")]
      .map((el) => el.getAttribute("data-sync-state"));
    expect(states).toEqual(["connected", "stale", "not-connected"]);
  });
});
