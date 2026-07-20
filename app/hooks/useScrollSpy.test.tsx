import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useScrollSpy } from "./useScrollSpy";

afterEach(cleanup);

function Harness({ ids, tops }: { ids: string[]; tops: Record<string, number> }) {
  const rootRef = { current: document.body as HTMLElement };
  // Stub getBoundingClientRect per section id so the hook math is deterministic.
  ids.forEach((id) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
    el.getBoundingClientRect = () =>
      ({ top: tops[id], bottom: tops[id] + 10, height: 10 }) as DOMRect;
  });
  const active = useScrollSpy(ids, { getRoot: () => rootRef.current, topOffset: 60 });
  return <span data-testid="active">{active ?? "none"}</span>;
}

describe("useScrollSpy", () => {
  it("returns the last section whose top is at or above the offset line", () => {
    // a is above the 60px line (top=10), b is below (top=200) -> active is a.
    const { getByTestId } = render(
      <Harness ids={["a", "b", "c"]} tops={{ a: 10, b: 200, c: 400 }} />,
    );
    act(() => {
      document.body.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("active").textContent).toBe("a");
  });

  it("returns null for an empty id list", () => {
    const { getByTestId } = render(<Harness ids={[]} tops={{}} />);
    expect(getByTestId("active").textContent).toBe("none");
  });
});
