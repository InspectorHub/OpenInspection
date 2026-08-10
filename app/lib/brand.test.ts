// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  contrastForeground,
  brandTokens,
  brandTextColor,
  BRAND_TEXT_SURFACE_LIGHT,
  BRAND_TEXT_SURFACE_DARK,
} from "~/lib/brand";

/* ── WCAG maths, written out here on purpose ──────────────────────────────
 * These do NOT import from `~/lib/brand`. A property test that borrows the
 * implementation's own luminance function cannot fail when that function is
 * the thing that is wrong — the error cancels on both sides of the assertion.
 * The formulas below come from WCAG 2.1 §1.4.3 / the sRGB definition.
 */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** sRGB -> HSL, used only to check the derivation stayed on one axis. */
function hsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    : max === gn ? ((bn - rn) / d + 2) / 6
    : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}
const AA = 4.5;
/**
 * Stride 3 = 86^3 = 636,056 samples (and it hits 255 on every axis). Cheap
 * enough for the pure-arithmetic pass. The derivation pass does a binary
 * search per colour, so it walks a coarser grid — stride 8, 32,768 samples —
 * and its assertion is unconditional, which is what makes the coarser grid
 * acceptable there and not here.
 */
function eachSampledColor(stride: number, fn: (r: number, g: number, b: number) => void) {
  let n = 0;
  for (let r = 0; r < 256; r += stride)
    for (let g = 0; g < 256; g += stride)
      for (let b = 0; b < 256; b += stride) { fn(r, g, b); n++; }
  return n;
}
const pct = (n: number, total: number) => `${((100 * n) / total).toFixed(2)}%`;

describe("contrastForeground", () => {
  it("returns dark text on light brand color", () => {
    expect(contrastForeground("#ffff00")).toBe("#111827"); // yellow → dark
  });
  it("returns white on dark brand color", () => {
    expect(contrastForeground("#1e293b")).toBe("#ffffff"); // slate → white
  });
  it("supports 3-digit hex", () => {
    expect(contrastForeground("#fff")).toBe("#111827");
    expect(contrastForeground("#000")).toBe("#ffffff");
  });
  it("tolerates a missing leading hash", () => {
    expect(contrastForeground("ffffff")).toBe("#111827");
  });
  it("falls back to white on invalid input", () => {
    expect(contrastForeground("not-a-color")).toBe("#ffffff");
    expect(contrastForeground("")).toBe("#ffffff");
  });
});

/**
 * The property that actually matters. A tenant may set ANY sRGB colour, so the
 * only honest statement about `contrastForeground` is one quantified over the
 * whole cube: whenever a readable foreground EXISTS, the function must return
 * it. Where neither white nor the dark token reaches 4.5:1 the pairing is
 * unwinnable — that is the "residual band", and it is measured, not excused.
 */
describe("contrastForeground over the sRGB cube", () => {
  it("never fails AA when one of its two candidates would have cleared it", () => {
    const white = relLuminance([255, 255, 255]);
    const dark = relLuminance(rgb("#111827"));
    let n = 0;
    let chosenFail = 0;
    let residual = 0;
    let worstChosen = { r: Infinity, hex: "" };
    let worstResidual = { r: Infinity, hex: "" };

    n = eachSampledColor(3, (r, g, b) => {
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      const fill = relLuminance([r, g, b]);
      const best = Math.max(ratio(white, fill), ratio(dark, fill));
      const chosen = ratio(relLuminance(rgb(contrastForeground(hex))), fill);
      if (chosen < AA) {
        chosenFail++;
        if (chosen < worstChosen.r) worstChosen = { r: chosen, hex };
      }
      if (best < AA) {
        residual++;
        if (best < worstResidual.r) worstResidual = { r: best, hex };
      }
    });

    console.info(
      `contrastForeground over ${n} colours: chosen-foreground fails AA ` +
        `${pct(chosenFail, n)} (worst ${worstChosen.r.toFixed(3)} @ ${worstChosen.hex}); ` +
        `unwinnable residual band ${pct(residual, n)} ` +
        `(worst ${worstResidual.r.toFixed(3)} @ ${worstResidual.hex}).`,
    );

    // Every failure must be an unwinnable one. Any excess is a bad pick.
    expect(chosenFail).toBe(residual);
    // And the residual band is a measured constant of the two-candidate design,
    // not a free parameter. 6.74% at this stride; the bound catches drift.
    expect(residual / n).toBeGreaterThan(0.065);
    expect(residual / n).toBeLessThan(0.07);
  }, 30_000);
});

/**
 * The other half. `contrastForeground` can only ever be as good as its two
 * candidates allow; the TEXT role has no such excuse, because the colour
 * itself is what moves. There is no residual band here — the assertion is
 * unconditional, on every sampled colour, on both surfaces.
 */
describe("brandTextColor over the sRGB cube", () => {
  it("always clears AA against the surface it targets, in both directions", () => {
    const surfaces = [
      { name: "light card", hex: BRAND_TEXT_SURFACE_LIGHT },
      { name: "dark card", hex: BRAND_TEXT_SURFACE_DARK },
    ];
    for (const surface of surfaces) {
      const bg = relLuminance(rgb(surface.hex));
      let n = 0;
      let failures = 0;
      let unchanged = 0;
      let worst = { r: Infinity, hex: "", got: "" };
      let biggestShift = { shift: 0, hex: "", got: "" };

      n = eachSampledColor(8, (r, g, b) => {
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        const got = brandTextColor(hex, surface.hex);
        const rt = ratio(relLuminance(rgb(got)), bg);
        if (rt < AA) failures++;
        if (rt < worst.r) worst = { r: rt, hex, got };
        if (got === hex) unchanged++;
        // How far along the lightness axis the colour had to travel, as a
        // fraction of the distance to the endpoint it moved toward.
        const [, , l0] = hsl(rgb(hex));
        const [, , l1] = hsl(rgb(got));
        const room = bg < 0.5 ? 1 - l0 : l0;
        const shift = room === 0 ? 0 : Math.abs(l1 - l0) / room;
        if (shift > biggestShift.shift) biggestShift = { shift, hex, got };
      });

      console.info(
        `brandTextColor on the ${surface.name} (${surface.hex}) over ${n} colours: ` +
          `${failures} below AA; ${pct(unchanged, n)} already cleared and were ` +
          `returned untouched; worst ${worst.r.toFixed(3)} (${worst.hex} -> ${worst.got}); ` +
          `largest lightness shift ${(100 * biggestShift.shift).toFixed(1)}% ` +
          `(${biggestShift.hex} -> ${biggestShift.got}).`,
      );
      expect({ surface: surface.name, failures }).toEqual({ surface: surface.name, failures: 0 });
    }
  }, 60_000);

  it("keeps the hue and saturation the tenant chose", () => {
    // The point of moving along the LIGHTNESS axis: a reader still recognises
    // the brand. 8 bits of rounding is the only allowed drift.
    for (const hex of ["#00ff00", "#ff0000", "#9f66ae", "#f59e0b", "#0ea5e9"]) {
      const [h0, s0] = hsl(rgb(hex));
      const [h1, s1] = hsl(rgb(brandTextColor(hex, BRAND_TEXT_SURFACE_LIGHT)));
      expect(Math.abs(h1 - h0)).toBeLessThan(0.01);
      expect(Math.abs(s1 - s0)).toBeLessThan(0.02);
    }
  });

  it("leaves the platform default alone — it already clears", () => {
    expect(brandTextColor("#6265f0", BRAND_TEXT_SURFACE_LIGHT)).toBe("#6265f0");
    expect(brandTextColor("#818cf8", BRAND_TEXT_SURFACE_DARK)).toBe("#818cf8");
  });

  it("moves in opposite directions for a light and a dark surface", () => {
    const onLight = brandTextColor("#00ff00", BRAND_TEXT_SURFACE_LIGHT);
    const onDark = brandTextColor("#00284d", BRAND_TEXT_SURFACE_DARK);
    expect(relLuminance(rgb(onLight))).toBeLessThan(relLuminance(rgb("#00ff00")));
    expect(relLuminance(rgb(onDark))).toBeGreaterThan(relLuminance(rgb("#00284d")));
  });

  it("falls back to a readable neutral for an unparseable colour", () => {
    expect(brandTextColor("not-a-color", BRAND_TEXT_SURFACE_LIGHT)).toBe("#111827");
    expect(brandTextColor("", BRAND_TEXT_SURFACE_DARK)).toBe("#ffffff");
  });
});

describe("brandTokens primary-text injection", () => {
  it("emits a light-dark() pair so one token serves both themes", () => {
    const tokens = brandTokens("#00ff00") as Record<string, string>;
    const light = brandTextColor("#00ff00", BRAND_TEXT_SURFACE_LIGHT);
    const dark = brandTextColor("#00ff00", BRAND_TEXT_SURFACE_DARK);
    expect(tokens["--ih-primary-text"]).toBe(`light-dark(${light}, ${dark})`);
    // The alias has to be re-pointed too — see the comment in brandTokens.
    expect(tokens["--color-ih-primary-text"]).toBe(tokens["--ih-primary-text"]);
    // The FILL stays the tenant's exact colour. That is the whole design.
    expect(tokens["--ih-primary"]).toBe("#00ff00");
  });
});

describe("brandTokens primary-fg injection", () => {
  it("injects --ih-primary-fg / --color-ih-primary-fg for a set color", () => {
    const tokens = brandTokens("#ffff00") as Record<string, string>;
    expect(tokens["--ih-primary-fg"]).toBe("#111827");
    expect(tokens["--color-ih-primary-fg"]).toBe("#111827");
  });
  it("returns no tokens when no color is set", () => {
    expect(brandTokens(null)).toEqual({});
    expect(brandTokens(undefined)).toEqual({});
  });
});
