import { describe, it, expect } from "vitest";
import { resolveQuickPhrases, parseQuickPhraseLines } from "~/lib/repair-quick-phrases";

const SEEDS = ["Repair requested", "Replacement requested"];

describe("resolveQuickPhrases", () => {
  it("shows the seeded defaults when the tenant never configured the list", () => {
    expect(resolveQuickPhrases(null, SEEDS)).toEqual(SEEDS);
    expect(resolveQuickPhrases(undefined, SEEDS)).toEqual(SEEDS);
  });

  it("shows NO phrases when the tenant cleared the list", () => {
    // The distinction that gives the tenant an off switch. Treating [] as
    // "unset" would make the feature impossible to disable — and because the
    // defaults look intentional, nobody would report it as a bug.
    expect(resolveQuickPhrases([], SEEDS)).toEqual([]);
  });

  it("uses the tenant's own phrases, in their order, once configured", () => {
    expect(resolveQuickPhrases(["Credit preferred", "Repair requested"], SEEDS)).toEqual([
      "Credit preferred",
      "Repair requested",
    ]);
  });

  it("drops blank entries rather than rendering an unclickable button", () => {
    expect(resolveQuickPhrases(["  Repair requested  ", "   ", ""], SEEDS)).toEqual([
      "Repair requested",
    ]);
  });
});

describe("parseQuickPhraseLines", () => {
  it("keeps line order, because line order IS button order", () => {
    expect(parseQuickPhraseLines("Second\nFirst")).toEqual(["Second", "First"]);
  });

  it("turns an emptied editor into [] — the off switch, not 'unset'", () => {
    expect(parseQuickPhraseLines("")).toEqual([]);
    expect(parseQuickPhraseLines("\n  \n")).toEqual([]);
  });

  it("trims each line and drops the blanks between them", () => {
    expect(parseQuickPhraseLines("  Repair requested \n\n  Replacement requested  \n")).toEqual([
      "Repair requested",
      "Replacement requested",
    ]);
  });
});
