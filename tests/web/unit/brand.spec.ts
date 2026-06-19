import { describe, it, expect } from "vitest";
import { contrastForeground, brandTokens } from "~/lib/brand";

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
