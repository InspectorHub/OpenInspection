// @vitest-environment happy-dom
/**
 * A colour that comes from the server (a tenant's rating, tag or category colour) is an unvalidated string that is written into a
 * style attribute. Each place that does so lets only a plain colour through; anything else is "no colour" and the token fallback shows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { DefectCategoryChip } from "../editor-shared/DefectCategoryChip";
import { RatingSegment } from "../editor-shared/RatingSegment";
import { BatchActionBar } from "./BatchActionBar";
import { ProgressStripText } from "./ProgressStripText";
import { SideRail } from "./SideRail";
import { TagChipRow } from "./TagChipRow";
import { TagPickerModal } from "./TagPickerModal";

afterEach(cleanup);

const BAD = "url(https://x.test/a.png)";
const inline = (el: Element | null) => (el?.getAttribute("style") ?? "").toLowerCase();
const clean = (el: Element | null) => {
  expect(inline(el)).not.toContain("url(");
  expect(inline(el)).not.toContain("x.test");
};

describe("colours from the server reach a style attribute only when they are plain colours", () => {
  it("the rating tile", () => {
    render(<RatingSegment ratings={[{ value: "x", label: "Repair", tone: "neutral" as const, color: BAD }]} value="x" onChange={() => {}} />);
    const tile = screen.getByRole("radio", { name: "Repair" });
    clean(tile);
    expect(tile.className).toContain("bg-ih-bg-inverse"); // the tone's own token classes apply instead
  });

  it("the batch bar tiles", () => {
    render(<BatchActionBar count={1} ratingLevels={[{ id: "a" }]} getRatingColor={() => BAD} onSelectAll={vi.fn()} onClear={vi.fn()} onSetRating={vi.fn()} onExit={vi.fn()} />);
    clean(screen.getByRole("radio", { name: "1" }));
  });

  it("the rating pill in the side rail", () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    render(
      <FieldDataSourceProvider dataSource={fake}>
        <SideRail locale="en-US" mode="fill" initialOpen activeItem={{ id: "i", label: "I" }} activeResult={{ rating: "r" }} inspectionId="x" getRatingColor={() => BAD} getRatingLabel={() => "Repair"} />
      </FieldDataSourceProvider>,
    );
    clean(screen.getByText("Repair"));
  });

  it("the tag chip", () => {
    render(<TagChipRow pinnedTags={[{ id: "t", name: "Urgent", color: BAD }]} activeTagIds={new Set(["t"])} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Urgent" });
    clean(chip);
    expect(chip.className).toContain("bg-ih-bg-muted");
  });

  const picker = (color: string) => {
    const tag = { id: "t", name: "Urgent", color };
    render(<TagPickerModal open activeItemId="i" tagsByItem={{ i: [tag] }} presetTags={[tag]} onToggle={vi.fn()} onClose={vi.fn()} />);
    return Array.from(document.body.querySelectorAll("[style]")).map((e) => inline(e));
  };

  // `amber`, `slate`, `rose`... are tag colours the server allows but not CSS colours: the browser would drop the fill and the
  // label would be white on the page. They take the fallback classes, with no white text and no fill.
  it.each(["amber", "slate"])("a tag chip in the non-CSS word %s falls back to the muted token classes", (word) => {
    render(<TagChipRow pinnedTags={[{ id: "t", name: "Urgent", color: word }]} activeTagIds={new Set(["t"])} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Urgent" });
    expect(chip.className).toContain("bg-ih-bg-muted");
    expect(chip.className).toContain("text-ih-fg-1");
    expect(chip.className).not.toContain("text-white");
    expect(inline(chip)).not.toContain(word);
  });

  it.each(["amber", "slate"])("the tag picker's selected chip for %s has the grey fallback fill with legible text, and no dot fill of that word", (word) => {
    const styles = picker(word);
    expect(styles.some((st) => st.includes("#6b7280") || st.includes("rgb(107, 114, 128)"))).toBe(true);
    expect(styles.every((st) => !st.includes(word))).toBe(true);
    expect(styles.some((st) => st.includes("--tw-ring-color"))).toBe(false);
  });

  it("a rating tile with a non-CSS word falls back to its token tone", () => {
    render(<RatingSegment ratings={[{ value: "x", label: "Repair", tone: "neutral" as const, color: "amber" }]} value="x" onChange={() => {}} />);
    const tile = screen.getByRole("radio", { name: "Repair" });
    expect(inline(tile)).not.toContain("amber");
    expect(inline(tile)).not.toContain("color: #fff");
    expect(tile.className).toContain("bg-ih-bg-inverse");
  });

  it("the tag picker paints a colour name: the dot, the active ring and the selected chip", () => {
    const styles = picker("red");
    expect(styles.filter((st) => st.includes("background-color: red")).length).toBeGreaterThanOrEqual(2); // dot + selected chip
    expect(styles.some((st) => st.includes("--tw-ring-color: red"))).toBe(true);
  });

  it("the tag picker paints no url(): the ring is left out and the chip keeps its fallback fill", () => {
    const styles = picker(BAD);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.some((st) => st.includes("#6b7280") || st.includes("rgb(107, 114, 128)"))).toBe(true);
    for (const st of styles) {
      expect(st).not.toContain("url(");
      expect(st).not.toContain("x.test");
    }
    expect(styles.some((st) => st.includes("--tw-ring-color"))).toBe(false);
  });

  it("the defect category chip", () => {
    render(<DefectCategoryChip category="safety" color={BAD} />);
    const chip = screen.getByText("safety");
    clean(chip);
    expect(chip.className).not.toContain("bg-ih-bg-muted"); // the category's own tokens, as for an unconfigured one
  });

  it("CONTROL - a plain colour is used as before", () => {
    render(<DefectCategoryChip category="safety" color="#123456" />);
    expect(screen.getByText("safety").getAttribute("style")).toContain("#123456");
    cleanup();
    render(<TagChipRow pinnedTags={[{ id: "t", name: "Urgent", color: "#ef4444" }]} activeTagIds={new Set(["t"])} onToggle={vi.fn()} />);
    expect(inline(screen.getByRole("button", { name: "Urgent" }))).toContain("#ef4444");
  });

  it.each([["red", "#ffffff"], ["yellow", "#0f172a"]])("a tag chip in the CSS name %s keeps its colour and gets legible text (%s)", (name, text) => {
    render(<TagChipRow pinnedTags={[{ id: "t", name: "Urgent", color: name }]} activeTagIds={new Set(["t"])} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Urgent" });
    expect(inline(chip)).toContain(`background-color: ${name}`);
    expect(inline(chip)).toContain(`color: ${text}`);
    expect(chip.className).not.toContain("bg-ih-bg-muted");
  });

  it("the progress dots keep their design tokens", () => {
    const { container } = render(<ProgressStripText rated={1} total={4} defects={2} monitor={1} etaMinutes={3} />);
    const fills = Array.from(container.querySelectorAll("span[style]")).map((e) => inline(e));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((f) => f.includes("var(--ih-status-"))).toBe(true);
  });
});
