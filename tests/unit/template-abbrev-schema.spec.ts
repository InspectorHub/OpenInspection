import { describe, it, expect } from "vitest";
import { TemplateSchemaV2Schema } from "../../server/lib/validations/template.schema";

describe("template schema accepts optional abbrev", () => {
  const base = {
    schemaVersion: 2,
    sections: [{
      id: "s1", title: "Roof",
      items: [{
        id: "i1", label: "Covering", type: "rich", ratingOptions: ["good"],
        tabs: {
          information: [{ id: "ri1", title: "Note", comment: "text", default: false, abbrev: "nt" }],
          limitations: [],
          defects: [{ id: "rd1", title: "Lifted", category: "recommendation", location: "", comment: "c", photos: [], default: false, abbrev: "shg" }],
        },
      }],
    }],
  };
  it("parses with abbrev present", () => {
    const r = TemplateSchemaV2Schema.safeParse(base);
    expect(r.success).toBe(true);
  });
  it("parses with abbrev absent (backward compat)", () => {
    const clone = structuredClone(base);
    delete (clone.sections[0].items[0].tabs.defects[0] as Record<string, unknown>).abbrev;
    expect(TemplateSchemaV2Schema.safeParse(clone).success).toBe(true);
  });
  it("rejects an abbrev longer than 12 chars", () => {
    const clone = structuredClone(base);
    (clone.sections[0].items[0].tabs.defects[0] as Record<string, unknown>).abbrev = "x".repeat(13);
    expect(TemplateSchemaV2Schema.safeParse(clone).success).toBe(false);
  });
});
