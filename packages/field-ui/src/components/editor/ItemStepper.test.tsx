// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemStepper } from "./ItemStepper";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pointer = (coarse: boolean): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarse && query.includes("pointer: coarse"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
};


describe("while a text field has focus", () => {
  it("the item stepper keeps its place but is out of sight, and is back when the field is left", async () => {
    pointer(true);
    render(
      <>
        <textarea aria-label="notes" />
        <ItemStepper neighbours={{ prev: null, next: { sectionId: "s", itemId: "i" }, position: { index: 1, total: 2 } }} onPrev={() => undefined} onNext={() => undefined} hideWhileTyping />
      </>,
    );
    const bar = screen.getByTestId("item-stepper");
    expect(bar.className).not.toContain("invisible");
    act(() => screen.getByLabelText("notes").focus());
    expect(bar.className).toContain("invisible");
    act(() => screen.getByLabelText("notes").blur());
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(bar.className).not.toContain("invisible");
  });

  it("never hides on a mouse device or when it is not asked to (the tablet / desktop pane), so Previous and Next stay reachable by Tab", () => {
    const neighbours = { prev: null, next: { sectionId: "s", itemId: "i" }, position: { index: 1, total: 2 } };
    pointer(false);
    const { unmount } = render(
      <>
        <textarea aria-label="notes" />
        <ItemStepper neighbours={neighbours} onPrev={() => undefined} onNext={() => undefined} hideWhileTyping />
      </>,
    );
    act(() => screen.getByLabelText("notes").focus());
    expect(screen.getByTestId("item-stepper").className).not.toContain("invisible");
    unmount();
    pointer(true);
    render(
      <>
        <textarea aria-label="notes" />
        <ItemStepper neighbours={neighbours} onPrev={() => undefined} onNext={() => undefined} />
      </>,
    );
    act(() => screen.getByLabelText("notes").focus());
    expect(screen.getByTestId("item-stepper").className).not.toContain("invisible");
  });
});
