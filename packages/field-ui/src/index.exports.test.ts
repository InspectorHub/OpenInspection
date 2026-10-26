// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as api from "./index";
import { findingKey as hookFindingKey } from "./hooks/findings/shared";

/**
 * The public surface of @inspectorhub/field-ui (its root entry). A host application installs the package from
 * npm, so an export that appears or disappears is a change to a published contract. Update the lists on
 * purpose, in the same commit as the change to `index.ts`.
 */
const VALUE_EXPORTS = [
  "DecodeImageError",
  "DEFAULT_INSPECTION_PREFS",
  "FieldDataSourceProvider",
  "FieldEditor",
  "METADATA_PRESETS",
  "RELIANCE_TEMPLATES",
  "appendPendingPhoto",
  "bindFieldLocaleSource",
  "escapeWillBeHandled",
  "findingKey",
  "findingsForUnit",
  "hasOpenLayer",
  "isIgnored",
  "isMetaKey",
  "resolvePcaNarrative",
  "resolvePendingPhoto",
  "setFieldLocale",
  "useFieldCommand",
  "useFieldDataSource",
  "useFieldEnsureHuman",
  "useFieldSlots",
];

/** The type names added for 0.3.0; the older ones are covered by the compiler (a host that imports them). */
const NEW_TYPE_EXPORTS = ["CoverPhotoOption", "GalleryPhoto", "PublishBlockingDefect", "PublishReadiness", "ReportProfileOption", "VideoUploadRef"];

/** Names from `export type { ... }` statements in the index source. */
function typeNamesInIndex(): string[] {
  const text = readFileSync(join(__dirname, "index.ts"), "utf8");
  const names: string[] = [];
  for (const m of text.matchAll(/export type \{([^}]*)\}/g)) {
    for (const n of m[1]!.split(",")) if (n.trim() !== "") names.push(n.trim());
  }
  return names;
}

describe("@inspectorhub/field-ui root entry", () => {
  it("exports exactly the listed values, and both counts are pinned", () => {
    const actual = Object.keys(api).sort();
    expect([actual.length, VALUE_EXPORTS.length]).toEqual([21, 21]);
    expect(actual).toEqual([...VALUE_EXPORTS].sort());
  });

  it("every listed value is defined (a re-export of nothing would still show up as a key)", () => {
    const record = api as Record<string, unknown>;
    for (const name of VALUE_EXPORTS) expect(record[name], name).toBeDefined();
  });

  it("the comparison fails when an export is missing or added (positive control)", () => {
    const actual = Object.keys(api).sort();
    expect(actual.filter((n) => n !== "FieldEditor")).not.toEqual([...VALUE_EXPORTS].sort());
    expect([...actual, "leaked"].sort()).not.toEqual([...VALUE_EXPORTS].sort());
  });

  it("the new type exports are named by the index (types are erased at runtime, so the source text is read)", () => {
    const names = typeNamesInIndex();
    for (const t of NEW_TYPE_EXPORTS) expect(names, t).toContain(t);
    // Positive control: a name that must not be there is not.
    expect(names).not.toContain("NotAnExport");
  });

  it("FieldEditor is the editor component and takes the data prop", () => {
    expect(typeof api.FieldEditor).toBe("function");
    expect(api.FieldEditor.length).toBe(1);
  });
});

describe("the exported helpers are the ones the server also uses, not look-alikes", () => {
  it("findingKey is the shared one: its result equals the hooks copy for the same input, and defaults a missing unit", () => {
    expect(api.findingKey(null, "s1", "i1")).toBe("_default:s1:i1");
    expect(api.findingKey(null, "s1", "i1")).toBe(hookFindingKey(null, "s1", "i1"));
    expect(api.findingKey("u1", "s1", "i1")).toBe("u1:s1:i1");
    // Only the shared copy accepts `undefined` for the unit.
    expect(api.findingKey(undefined, "s1", "i1")).toBe("_default:s1:i1");
  });

  it("isMetaKey tells a document-level key from a finding key", () => {
    expect(api.isMetaKey("_inspector_signature")).toBe(true);
    expect(api.isMetaKey("_default:s1:i1")).toBe(false);
    expect(api.isMetaKey("u1:s1:i1")).toBe(false);
  });

  it("findingsForUnit keeps only the keys of one unit", () => {
    const data = { "u1:s:a": 1, "u1:s:b": 2, "u2:s:a": 3 };
    expect(Object.keys(api.findingsForUnit(data, "u1")).length).toBe(2);
    expect(Object.keys(api.findingsForUnit(data, "u9")).length).toBe(0);
  });

  it("RELIANCE_TEMPLATES holds non-empty texts", () => {
    const values = Object.values(api.RELIANCE_TEMPLATES);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) expect(typeof v === "string" && v.length > 0).toBe(true);
  });

  it("METADATA_PRESETS carries the commercial presets that a host filters by prefix", () => {
    const keys = Object.keys(api.METADATA_PRESETS);
    const commercial = keys.filter((k) => k.startsWith("commercial:"));
    expect([commercial.length, keys.length > commercial.length]).toEqual([6, true]);
    expect(api.METADATA_PRESETS["commercial:office"]?.length).toBeGreaterThan(0);
  });

  it("resolvePcaNarrative returns a narrative object for empty input", () => {
    const n = api.resolvePcaNarrative(undefined);
    expect(typeof n).toBe("object");
    expect(n).not.toBeNull();
  });

  it("the layer helpers share one stack with the components: nothing open means nothing to consume", () => {
    expect(api.hasOpenLayer()).toBe(false);
    expect(api.escapeWillBeHandled()).toBe(false);
  });

  it("DEFAULT_INSPECTION_PREFS has the preference keys the editor reads", () => {
    expect(Object.keys(api.DEFAULT_INSPECTION_PREFS).length).toBeGreaterThan(0);
  });
});
