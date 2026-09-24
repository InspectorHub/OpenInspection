/**
 * The ISN panel's load: which stored secrets map onto the panel's fields.
 * The save (blank field = unchanged) now goes through the `putSecrets` closure
 * inside settings-advanced.tsx's `action`, shared with the Integration Keys
 * panel — see that file for why, and scripts/check-middleware-budget.mjs for
 * the budget it keeps inside.
 */
import { describe, expect, it } from "vitest";
import { loadIsnSettings } from "./isn-settings.server";

describe("loadIsnSettings", () => {
  it("maps only the known ISN keys onto the panel, defaulting anything missing to empty", () => {
    const out = loadIsnSettings({ ISN_DOMAIN: "https://inspectionsupport.com", UNRELATED_KEY: "x" });
    expect(out).toEqual({
      ISN_DOMAIN: "https://inspectionsupport.com",
      ISN_COMPANY_KEY: "",
      ISN_ACCESS_KEY: "",
      ISN_SECRET_KEY: "",
    });
  });

  it("defaults every field to empty when nothing is stored yet", () => {
    expect(loadIsnSettings({})).toEqual({
      ISN_DOMAIN: "",
      ISN_COMPANY_KEY: "",
      ISN_ACCESS_KEY: "",
      ISN_SECRET_KEY: "",
    });
  });
});
