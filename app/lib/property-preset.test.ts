import { describe, it, expect } from "vitest";
import { resolveActivePropertyPreset } from "./property-preset";
import type { PropertyMetaField } from "../../server/lib/commercial-subtypes";

const presets: Record<string, PropertyMetaField[]> = {
  "commercial:office": [
    { id: "yearBuilt", label: "Year built", type: "number" },
    { id: "nra", label: "Net rentable area", type: "number" },
    { id: "sprinklered", label: "Sprinklered", type: "select", options: ["Full", "None"] },
  ],
  "commercial:retail": [
    { id: "yearBuilt", label: "Year built", type: "number" },
    { id: "gla", label: "Gross leasable area", type: "number" },
  ],
};

describe("resolveActivePropertyPreset", () => {
  it("returns the subtype preset for a commercial inspection with a chosen subtype", () => {
    const office = resolveActivePropertyPreset("commercial", "office", presets);
    expect(office?.map((f) => f.id)).toEqual(["yearBuilt", "nra", "sprinklered"]);
  });

  it("reacts to a subtype change (office → retail)", () => {
    const retail = resolveActivePropertyPreset("commercial", "retail", presets);
    expect(retail?.map((f) => f.id)).toContain("gla");
  });

  it("returns undefined for a residential inspection (no preset → default fields, no regression)", () => {
    expect(resolveActivePropertyPreset("residential", null, presets)).toBeUndefined();
    expect(resolveActivePropertyPreset("single_family", null, presets)).toBeUndefined();
  });

  it("returns undefined for commercial with no subtype yet (avoids an empty form)", () => {
    expect(resolveActivePropertyPreset("commercial", null, presets)).toBeUndefined();
    expect(resolveActivePropertyPreset("commercial", "", presets)).toBeUndefined();
  });

  it("returns undefined for an unknown/org-custom subtype not in the preset map", () => {
    expect(resolveActivePropertyPreset("commercial", "custom-boutique-hotel", presets)).toBeUndefined();
  });
});
