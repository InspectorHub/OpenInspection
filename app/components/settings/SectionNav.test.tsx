import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { SectionNav } from "./SectionNav";

afterEach(cleanup);
beforeEach(() => {
  // happy-dom lacks real scroll methods; stub them so spies/calls don't throw.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
});

describe("SectionNav", () => {
  it("renders nothing when fewer than 3 sections are visible", () => {
    const { container } = render(
      <SectionNav
        sections={[
          { id: "a", label: "A" },
          { id: "b", label: "B", visible: false },
          { id: "c", label: "C", visible: false },
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a tab per visible section", () => {
    render(
      <SectionNav
        sections={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Bravo" },
          { id: "c", label: "Charlie", visible: false },
          { id: "d", label: "Delta" },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Section navigation" })).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();
    expect(screen.getByText("Delta")).toBeTruthy();
    expect(screen.queryByText("Charlie")).toBeNull();
  });

  it("scrolls the target section into the scroll container on tab click", () => {
    const target = document.createElement("div");
    target.id = "b";
    document.body.appendChild(target);
    render(
      <SectionNav
        sections={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Bravo" },
          { id: "d", label: "Delta" },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Bravo"));
    expect(target.scrollIntoView).toHaveBeenCalled();
  });
});
