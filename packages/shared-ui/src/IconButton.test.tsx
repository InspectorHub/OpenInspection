// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
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

  it("pending keeps focus, shows aria-disabled and swallows clicks", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton aria-label="Remove" onClick={onClick}>
        <Icon name="filter" />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Remove" });
    btn.focus();
    rerender(
      <IconButton aria-label="Remove" onClick={onClick} pending>
        <Icon name="filter" />
      </IconButton>,
    );
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    rerender(
      <IconButton aria-label="Remove" onClick={onClick}>
        <Icon name="filter" />
      </IconButton>,
    );
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a caller-supplied aria-disabled survives when not pending, and pending still wins", () => {
    const { rerender } = render(
      <IconButton aria-label="Remove" aria-disabled="true">
        <Icon name="filter" />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Remove" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    rerender(
      <IconButton aria-label="Remove" aria-disabled="false" pending>
        <Icon name="filter" />
      </IconButton>,
    );
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it.each([
    ["primary", "aria-disabled:hover:bg-ih-primary"],
    ["secondary", "aria-disabled:hover:bg-ih-bg-card"],
    ["ghost", "aria-disabled:hover:bg-transparent"],
    ["danger", "aria-disabled:hover:opacity-50"],
  ] as const)("%s variant suppresses its hover look while aria-disabled", (variant, cls) => {
    render(
      <IconButton aria-label="x" variant={variant} pending>
        <Icon name="filter" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "x" }).className.split(/\s+/)).toContain(cls);
  });
});
