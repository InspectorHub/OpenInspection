// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useState } from "react";
import { TestConnectionButton } from "./TestConnectionButton";

afterEach(cleanup);

function fakeFetcher(state: "idle" | "submitting") {
  return { state, Form: "form" } as never;
}

let setProbeState: (state: "idle" | "submitting") => void = () => {};

function Harness() {
  const [state, setState] = useState<"idle" | "submitting">("idle");
  setProbeState = setState;
  return <TestConnectionButton fetcher={fakeFetcher(state)} intent="x" />;
}

function mount() {
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("TestConnectionButton while a probe is in flight", () => {
  it("stays enabled for focus (aria-disabled, no native disabled) and swallows a second submit", () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const { container } = mount();
    const btn = screen.getByRole("button");
    btn.focus();
    act(() => setProbeState("submitting"));
    container.querySelector("form")!.addEventListener("submit", onSubmit as EventListener);
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is not aria-disabled when idle", () => {
    mount();
    expect(screen.getByRole("button").hasAttribute("aria-disabled")).toBe(false);
  });
});
