import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const css = readFileSync(join(__dirname, "theme.css"), "utf8");
const ruleFor = (selector: string) => new RegExp(`${selector.replace(/[.[\]]/g, "\\$&")}[^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("placeholder colour", () => {
  it.each([".ih-input::placeholder", "textarea::placeholder"])("%s is the fg-3 text tier, fully opaque", (selector) => {
    const body = ruleFor(selector);
    expect(body).toContain("color: var(--ih-fg-3)");
    expect(body).toContain("opacity: 1");
  });

  it("CONTROL - it is not the fg-4 decoration tier (2.56:1 on a light card)", () => {
    expect(ruleFor(".ih-input::placeholder")).not.toContain("--ih-fg-4");
  });
});
