// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Button } from "@core/shared-ui";

afterEach(cleanup);

describe("Button pending", () => {
  it("renders aria-disabled and no native disabled, and keeps focus", () => {
    const { rerender } = render(<Button>Go</Button>);
    const btn = screen.getByRole("button");
    btn.focus();
    rerender(<Button pending>Go</Button>);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.className).toContain("aria-disabled:opacity-50");
    expect(document.activeElement).toBe(btn);
  });

  it("has no aria-disabled when not pending", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").hasAttribute("aria-disabled")).toBe(false);
  });

  it("swallows clicks while pending and passes them through otherwise", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button pending onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not submit an enclosing form while pending, and does otherwise", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}><Button type="submit" pending>Go</Button></form>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<form onSubmit={onSubmit}><Button type="submit">Go</Button></form>);
    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves native disabled in force when both are given", () => {
    const onClick = vi.fn();
    render(<Button disabled pending onClick={onClick}>Go</Button>);
    const btn = screen.getByRole("button");
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
