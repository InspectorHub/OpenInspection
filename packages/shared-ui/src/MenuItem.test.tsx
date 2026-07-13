import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MenuItem } from "./MenuItem";

afterEach(cleanup);

describe("MenuItem", () => {
  it("renders a full-width left-aligned menuitem", () => {
    render(<MenuItem>Duplicate</MenuItem>);
    const item = screen.getByRole("menuitem", { name: "Duplicate" });
    expect(item.className).toContain("w-full");
    expect(item.className).toContain("text-left");
  });

  it("danger tone uses bad-fg token", () => {
    render(<MenuItem tone="danger">Delete</MenuItem>);
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toContain("text-ih-bad-fg");
  });

  it("renders rich children as direct flex children (no wrapping span)", () => {
    render(
      <MenuItem>
        <span className="flex-1 text-left text-sm">Speed mode</span>
        <span className="ih-kbd">Z</span>
      </MenuItem>,
    );
    const item = screen.getByRole("menuitem", { name: "Speed mode Z" });
    // Both children must be direct children of the button — a wrapping <span>
    // around them would put flex-1 inside a non-flex parent and break the
    // right-aligned hotkey-badge layout.
    const directChildren = Array.from(item.children) as HTMLElement[];
    expect(directChildren).toHaveLength(2);
    expect(directChildren[0].className).toContain("flex-1");
    expect(directChildren[1].textContent).toBe("Z");
  });
});
