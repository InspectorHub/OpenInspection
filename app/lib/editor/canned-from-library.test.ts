import { describe, it, expect } from "vitest";
import { TAB_SEVERITY, buildCannedFromText } from "~/lib/editor/canned-from-library";

describe("TAB_SEVERITY", () => {
  it("maps each template comment tab to its severity (the single canonical vocabulary)", () => {
    expect(TAB_SEVERITY.information).toBe("good");
    expect(TAB_SEVERITY.limitations).toBe("marginal");
    expect(TAB_SEVERITY.defects).toBe("significant");
  });
});

describe("buildCannedFromText", () => {
  it("fills title (truncated) + comment from the library text", () => {
    const long = "x".repeat(100);
    const c = buildCannedFromText("information", long, () => "ri_1");
    expect(c.id).toBe("ri_1");
    expect(c.comment).toBe(long);
    expect(c.title.length).toBe(48);
    expect(c.default).toBe(false);
  });

  it("adds defect-only fields for the defects tab", () => {
    const c = buildCannedFromText("defects", "Cracked flue liner", () => "rd_1");
    expect(c).toMatchObject({ category: "recommendation", location: "", photos: [] });
  });

  it("omits defect-only fields for information/limitations tabs", () => {
    const info = buildCannedFromText("information", "Serviceable", () => "ri_1");
    const lim = buildCannedFromText("limitations", "Not accessible", () => "rl_1");
    expect(info.category).toBeUndefined();
    expect(info.photos).toBeUndefined();
    expect(lim.category).toBeUndefined();
  });

  it("defaults the id prefix per tab when no generator is passed", () => {
    expect(buildCannedFromText("defects", "t").id.startsWith("rd_")).toBe(true);
    expect(buildCannedFromText("limitations", "t").id.startsWith("rl_")).toBe(true);
    expect(buildCannedFromText("information", "t").id.startsWith("ri_")).toBe(true);
  });
});
