import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";

afterEach(cleanup);

describe("IconButton", () => {
  it("is square, icon-only, requires aria-label", () => {
    render(
      <IconButton aria-label="Close" size="md">
        <Icon name="x" />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn.className).toContain("w-9");
    expect(btn.className).toContain("h-9");
    expect(btn.className).not.toContain("px-");
  });

  it("consumer size className wins over the size preset's width/height", () => {
    render(
      <IconButton aria-label="x" size="md" className="w-6 h-6">
        <Icon name="x" />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "x" });
    expect(btn.className).toContain("w-6");
    expect(btn.className).toContain("h-6");
    const classes = btn.className.split(/\s+/);
    expect(classes).not.toContain("w-9");
    expect(classes).not.toContain("h-9");
  });

  it("selected toggles aria-pressed", () => {
    render(
      <IconButton aria-label="Filter" selected>
        <Icon name="filter" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("unselected omits aria-pressed", () => {
    render(
      <IconButton aria-label="Filter">
        <Icon name="filter" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Filter" }).hasAttribute("aria-pressed")).toBe(false);
  });
});
