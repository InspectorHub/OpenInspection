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

  // The four seeded palette names (`amber`, `slate`, `rose`, `emerald`) are tag colours the server allows but not CSS colours. They
  // are painted from their hex, and the ink is chosen from that hex: dark on the light fills, white on the dark ones.
  const PALETTE_INK = [["amber", "#f59e0b", "#0f172a"], ["emerald", "#10b981", "#0f172a"], ["slate", "#64748b", "#ffffff"], ["rose", "#f43f5e", "#ffffff"]] as const;
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const hasRgb = (st: string, hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return norm(st).includes(hex) || norm(st).includes(`rgb(${r},${g},${b})`);
  };

  it.each(PALETTE_INK)("an active tag chip in the palette name %s is filled with %s and carries the ink %s", (word, fill, ink) => {
    render(<TagChipRow pinnedTags={[{ id: "t", name: "Urgent", color: word }]} activeTagIds={new Set(["t"])} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Urgent" });
    const st = inline(chip);
    expect(hasRgb(st.split("background-color")[1] ?? "", fill)).toBe(true);
    expect(hasRgb(st.split(/;\s*color/)[1] ?? "", ink)).toBe(true);
    expect(st).not.toContain(word);
  });

  it.each(PALETTE_INK)("the tag picker's selected chip, dot and ring for %s use %s, never the word", (word, fill, ink) => {
    const styles = picker(word);
    expect(styles.filter((st) => hasRgb(st.split("background-color")[1] ?? "", fill)).length).toBeGreaterThanOrEqual(2); // dot + selected chip
    expect(styles.some((st) => hasRgb(st.split("--tw-ring-color")[1] ?? "", fill))).toBe(true);
    expect(styles.some((st) => hasRgb(st.split(/;\s*color/)[1] ?? "", ink))).toBe(true);
    expect(styles.every((st) => !st.includes(word))).toBe(true);
  });

  it("a tag chip in a word that is not a colour still falls back to the muted token classes", () => {
    render(<TagChipRow pinnedTags={[{ id: "t", name: "Urgent", color: "rebeccapurple" }]} activeTagIds={new Set(["t"])} onToggle={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Urgent" });
    expect(chip.className).toContain("bg-ih-bg-muted");
    expect(chip.className).toContain("text-ih-fg-1");
    expect(chip.className).not.toContain("text-white");
    expect(inline(chip)).not.toContain("rebeccapurple");
  });

  it("the tag picker's selected chip for a word that is not a colour has the grey fallback fill and no ring", () => {
    const styles = picker("rebeccapurple");
    expect(styles.some((st) => st.includes("#6b7280") || st.includes("rgb(107, 114, 128)"))).toBe(true);
    expect(styles.every((st) => !st.includes("rebeccapurple"))).toBe(true);
    expect(styles.some((st) => st.includes("--tw-ring-color"))).toBe(false);
  });

  it("a rating tile with a non-CSS word falls back to its token tone", () => {
    render(<RatingSegment ratings={[{ value: "x", label: "Repair", tone: "neutral" as const, color: "rebeccapurple" }]} value="x" onChange={() => {}} />);
    const tile = screen.getByRole("radio", { name: "Repair" });
    expect(inline(tile)).not.toContain("rebeccapurple");
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
