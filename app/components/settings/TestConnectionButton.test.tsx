// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { TestConnectionButton } from "./TestConnectionButton";

afterEach(cleanup);

function fakeFetcher(state: "idle" | "submitting") {
  return { state, Form: "form" } as never;
}

describe("TestConnectionButton while a probe is in flight", () => {
  it("stays enabled for focus (aria-disabled, no native disabled) and swallows a second submit", () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const { container, rerender } = render(<TestConnectionButton fetcher={fakeFetcher("idle")} intent="x" />);
    const btn = screen.getByRole("button");
    btn.focus();
    rerender(<TestConnectionButton fetcher={fakeFetcher("submitting")} intent="x" />);
    container.querySelector("form")!.addEventListener("submit", onSubmit as EventListener);
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is not aria-disabled when idle", () => {
    render(<TestConnectionButton fetcher={fakeFetcher("idle")} intent="x" />);
    expect(screen.getByRole("button").hasAttribute("aria-disabled")).toBe(false);
  });
});
