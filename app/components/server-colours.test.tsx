// @vitest-environment happy-dom
/**
 * A colour that comes from the server or a tenant (a brand colour, a style profile, a rating or category colour) is an
 * unvalidated string that is written into a style attribute or a CSS custom property. Only a plain colour gets through.
 *
 * `background-color`, `color` and `border-color` already drop a value that is not a colour (a `url(...)` is not one), so the
 * library pages and editors that only set those need no test of their own: their guard (`safeCssColor`) is a second line.
 * What the DOM does NOT drop is a custom property, and the `background` shorthand: those are what is asserted here.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brandTokens } from "~/lib/brand";
import { presetTokens } from "~/lib/report-style/preset-tokens";
import { TagSwatch } from "~/components/TagSwatch";
import { ReportItemCard } from "~/components/portal/sections/report/ReportItemCard";
import type { ReportItem } from "~/components/portal/sections/report/types";

afterEach(cleanup);

const BAD = "url(https://x.test/a.png)";

describe("brandTokens", () => {
  it("uses the platform default for a colour its own parser cannot read (a name, rgb(), a token), not a fill with an unmatched text colour", () => {
    for (const other of ["red", "rgb(29, 78, 216)", "hsl(220 80% 48%)", "#1d4ed8cc"]) expect(brandTokens(other), other).toEqual({});
  });

  it("treats a colour that is not a plain colour as no tenant colour", () => {
    for (const bad of [BAD, "red; background:url(x)", "expression(1)", "var(--x)"]) expect(brandTokens(bad)).toEqual({});
  });

  it("CONTROL - a hex colour still re-points the tokens", () => {
    expect(brandTokens("#1d4ed8")["--ih-primary" as never]).toBe("#1d4ed8");
  });
});

describe("presetTokens", () => {
  it("falls back to the base value for a colour token that is not a plain colour, and leaves the other tokens as given", () => {
    const out = presetTokens({ ink: BAD, paper: "red; x:y", muted: "#112233", radius: "9px" }) as Record<string, string>;
    expect(out["--report-ink"]).toBe("#22201d");
    expect(out["--report-paper"]).toBe("#ffffff");
    expect(out["--report-muted"]).toBe("#112233");
    expect(out["--report-radius"]).toBe("9px");
    expect(Object.values(out).some((v) => v.includes("x.test"))).toBe(false);
  });
});

describe("ReportItemCard rating colour", () => {
  const item = { id: "i", label: "Roof", ratingLabel: "Repair", ratingColor: "#ef4444", photos: [], defects: [] } as unknown as ReportItem;
  const card = (over: Partial<ReportItem>) =>
    render(<ReportItemCard item={{ ...item, ...over }} showEstimates={false} showPhotos={false} mediaVisible={() => false} renderMediaTile={() => null} selectedForRepair={false} onToggleRepairItem={vi.fn()} />);

  // No url() test here: the pill sets `background` as `<colour>20`, which the DOM drops when the colour is not a plain one, so such a test
  // could not fail. The guard in the card is a second line; what the card must keep is the tint for a real colour.
  it("a hex rating colour tints the pill", () => {
    card({ ratingColor: "#ef4444" });
    expect(screen.getByText("Repair").getAttribute("style")).toContain("#ef4444");
  });
});

describe("TagSwatch (the library and the inspection settings)", () => {
  it("paints a hex colour and a CSS colour name", () => {
    render(<><TagSwatch color="#ef4444" className="a" /><TagSwatch color="red" className="b" /></>);
    expect(document.querySelector(".a")?.getAttribute("style")).toContain("#ef4444");
    expect(document.querySelector(".b")?.getAttribute("style")).toContain("background-color: red");
  });

  it.each([["amber", "#f59e0b", [245, 158, 11]], ["slate", "#64748b", [100, 116, 139]], ["rose", "#f43f5e", [244, 63, 94]], ["emerald", "#10b981", [16, 185, 129]]] as const)(
    "paints the seeded palette name %s from its hex, not the word",
    (word, hex, [r, g, b]) => {
      render(<TagSwatch color={word} className="p" />);
      const style = (document.querySelector(".p")?.getAttribute("style") ?? "").replace(/\s+/g, "").toLowerCase();
      expect(style.includes(hex) || style.includes(`rgb(${r},${g},${b})`)).toBe(true);
      expect(style).not.toContain(word);
    },
  );

  it("draws nothing for a colour that is not a plain colour, a word that is not a colour, or none", () => {
    const { container } = render(<><TagSwatch color={BAD} /><TagSwatch color="red;x" /><TagSwatch color="rebeccapurple" /><TagSwatch color="foo" /><TagSwatch color={null} /></>);
    expect(container.innerHTML).toBe("");
  });
});

describe("a tint of a data colour", () => {
  const withColour = (ratingColor: string) =>
    render(<ReportItemCard item={{ id: "i", label: "Roof", ratingLabel: "Repair", ratingColor, photos: [], defects: [] } as unknown as ReportItem} showEstimates={false} showPhotos={false} mediaVisible={() => false} renderMediaTile={() => null} selectedForRepair={false} onToggleRepairItem={vi.fn()} />);

  it("the report pill is tinted for a 6-digit hex only", () => {
    withColour("#ef4444");
    expect(screen.getByText("Repair").getAttribute("style")).toContain("background: #ef444420");
    cleanup();
    for (const other of ["red", "#f44", "rgb(239,68,68)"]) {
      withColour(other);
      const style = screen.getByText("Repair").getAttribute("style") ?? "";
      expect(style, other).not.toContain("background");
      expect(style, other).toContain("color");
      cleanup();
    }
  });
});
