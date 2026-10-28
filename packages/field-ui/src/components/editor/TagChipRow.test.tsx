// @vitest-environment happy-dom
/**
 * The chip row under an item's notes. It is the only tag control a phone has: the full tag list is a modal that
 * used to open on the T key alone, and the row gave no way to open it. The row is shared by the web editor and the
 * native app, so what it offers has to be the same on both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagChipRow, type TagPin } from "./TagChipRow";

afterEach(cleanup);

const tag = (id: string, name = id): TagPin => ({ id, name, color: "#ef4444" });
const MORE = { name: /open tag library/i };

describe("TagChipRow — reaching the full tag list", () => {
  it("offers an opener, and calls it when pressed", () => {
    const open = vi.fn();
    render(<TagChipRow pinnedTags={[tag("a", "Alpha")]} activeTagIds={new Set()} onToggle={vi.fn()} onOpenLibrary={open} />);
    fireEvent.click(screen.getByRole("button", MORE));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("still offers the opener when no tag is pinned (a new company pins none, and the phone has no T key)", () => {
    const open = vi.fn();
    render(<TagChipRow pinnedTags={[]} activeTagIds={new Set()} onToggle={vi.fn()} onOpenLibrary={open} />);
    fireEvent.click(screen.getByRole("button", MORE));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when there is nothing to show and no way to open the list (the control for the two above)", () => {
    const { container } = render(<TagChipRow pinnedTags={[]} activeTagIds={new Set()} onToggle={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("has no opener when the host gave none", () => {
    render(<TagChipRow pinnedTags={[tag("a", "Alpha")]} activeTagIds={new Set()} onToggle={vi.fn()} />);
    expect(screen.queryByRole("button", MORE)).toBeNull();
  });
});

describe("TagChipRow — what is on the item", () => {
  it("shows a tag the inspector chose from the full list even though it is not pinned, after the pinned ones", () => {
    render(
      <TagChipRow
        pinnedTags={[tag("a", "Alpha")]}
        chosenTags={[tag("z", "Zulu")]}
        activeTagIds={new Set(["z"])}
        onToggle={vi.fn()}
      />,
    );
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Alpha", "Zulu"]);
  });

  it("lets such a chip be pressed to take the tag off again", () => {
    const toggle = vi.fn();
    render(<TagChipRow pinnedTags={[]} chosenTags={[tag("z", "Zulu")]} activeTagIds={new Set(["z"])} onToggle={toggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Zulu" }));
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "z" }));
  });

  it("does not show a tag twice when it is both pinned and listed as extra", () => {
    render(<TagChipRow pinnedTags={[tag("a", "Alpha")]} chosenTags={[tag("a", "Alpha")]} activeTagIds={new Set(["a"])} onToggle={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Alpha" })).toHaveLength(1);
  });

  it("still shows at most five pinned tags, and does not cut the chosen ones", () => {
    const pinned = ["a", "b", "c", "d", "e", "f", "g"].map((id) => tag(id, id.toUpperCase()));
    render(<TagChipRow pinnedTags={pinned} chosenTags={[tag("z", "Zulu")]} activeTagIds={new Set(["z"])} onToggle={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["A", "B", "C", "D", "E", "Zulu"]);
  });
});

describe("TagChipRow — the opener's colour", () => {
  // `fg-4` measured 2.45:1 (light) and 3.75:1 (dark) as 12px text; `fg-3`, the colour of an unselected chip, measured
  // 4.55:1 and 6.96:1. The opener is a phone's only way to the tag list, so it must read.
  it("uses the same text colour as an unselected chip, not the fainter one", () => {
    render(<TagChipRow pinnedTags={[tag("a", "Alpha")]} activeTagIds={new Set()} onToggle={vi.fn()} onOpenLibrary={vi.fn()} />);
    const opener = screen.getByRole("button", MORE);
    expect(opener.className).toContain("text-ih-fg-3");
    expect(opener.className).not.toContain("text-ih-fg-4");
    expect(screen.getByRole("button", { name: "Alpha" }).className).toContain("text-ih-fg-3");
  });
});

describe("TagChipRow — touch", () => {
  // jsdom evaluates no media queries, so this pins the classes; the size itself was measured in a phone viewport.
  it("gives every chip and the opener a finger-sized minimum height on a coarse pointer", () => {
    render(<TagChipRow pinnedTags={[tag("a", "Alpha")]} activeTagIds={new Set()} onToggle={vi.fn()} onOpenLibrary={vi.fn()} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("[@media(pointer:coarse)]:min-h-9");
    }
  });
});
