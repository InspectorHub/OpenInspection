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
      />,
    );

    expect(getByRole("button", { name: "Alex" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "Sam" }).getAttribute("aria-pressed")).toBe("false");
  });
});
