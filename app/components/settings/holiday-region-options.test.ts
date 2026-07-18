import { describe, it, expect } from "vitest";
import { SUPPORTED_STATE_CODES, regionOptionLabel, stateName } from "./holiday-region-options";

describe("holiday region labels", () => {
  it("spells the state out and keeps the code", () => {
    // "TX" alone assumes the reader knows USPS abbreviations. The full name
    // carries the meaning; the code stays for anyone cross-checking the
    // statutory holiday list.
    expect(regionOptionLabel("TX")).toBe("Federal + Texas (TX)");
    expect(regionOptionLabel("CA")).toBe("Federal + California (CA)");
  });

  it("names every bundled state", () => {
    // A code with no name would render "Federal +  (XX)" — guard the whole set
    // so adding a state to the catalog forces adding its name.
    for (const code of SUPPORTED_STATE_CODES) {
      expect(stateName(code)).toMatch(/^[A-Z]/);
    }
  });
});
