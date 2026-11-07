// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ItemStepper } from "./ItemStepper";

afterEach(cleanup);

describe("while a text field has focus", () => {
  it("the item stepper keeps its place but is out of sight, and is back when the field is left", async () => {
    render(
      <>
        <textarea aria-label="notes" />
        <ItemStepper neighbours={{ prev: null, next: { sectionId: "s", itemId: "i" }, position: { index: 1, total: 2 } }} onPrev={() => undefined} onNext={() => undefined} />
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
});
