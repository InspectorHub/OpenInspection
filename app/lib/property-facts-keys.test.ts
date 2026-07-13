import { describe, it, expect } from "vitest";
import { DEDICATED_FACT_KEYS, isDedicatedFactKey } from "./property-facts-keys";

describe("DEDICATED_FACT_KEYS", () => {
  it("contains exactly the ten schema-backed keys", () => {
    expect([...DEDICATED_FACT_KEYS].sort()).toEqual(
      [
        "bathrooms",
        "bedrooms",
        "commercialSubtype",
        "county",
        "foundationType",
        "lotSize",
        "reportTier",
        "sqft",
        "unit",
        "yearBuilt",
      ].sort(),
    );
  });

  it("classifies a commercial preset key as non-dedicated", () => {
    expect(isDedicatedFactKey("nra")).toBe(false);
    expect(isDedicatedFactKey("yearBuilt")).toBe(true);
  });
});
