/**
 * The Profile page's Save button now owns exactly one card, and the email
 * signature toggle saves itself. That move created a trap on the way out.
 */
import { describe, it, expect } from "vitest";
import { signatureEnabledFromForm } from "./settings-profile";

function form(...pairs: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
}

describe("signatureEnabledFromForm", () => {
  it("returns undefined when the form does not carry the field at all", () => {
    // THE ONE THAT MATTERS. The profile form no longer submits this field, so
    // reading it as a boolean would evaluate `undefined === "true"` and write
    // `false` — switching an inspector's email signature off every time they
    // saved an unrelated field, with nothing on screen to say so.
    expect(signatureEnabledFromForm(form(["name", "Dana"]))).toBeUndefined();
    expect(signatureEnabledFromForm(form())).toBeUndefined();
  });

  it("takes the LAST value, because a checked box arrives after its hidden false", () => {
    expect(signatureEnabledFromForm(form(["signatureEnabled", "false"], ["signatureEnabled", "true"]))).toBe(true);
    expect(signatureEnabledFromForm(form(["signatureEnabled", "false"]))).toBe(false);
  });

  it("reads a single explicit value", () => {
    expect(signatureEnabledFromForm(form(["signatureEnabled", "true"]))).toBe(true);
  });

  it("treats anything that is not the string \"true\" as off", () => {
    for (const v of ["", "1", "on", "TRUE", "yes"]) {
      expect(signatureEnabledFromForm(form(["signatureEnabled", v])), v).toBe(false);
    }
  });
});
