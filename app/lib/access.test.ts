import { describe, it, expect } from "vitest";
import { isAdminRole, assertAdminOrForbidden } from "~/lib/access";

describe("isAdminRole", () => {
  it("owner is admin", () => expect(isAdminRole("owner")).toBe(true));
  it("manager is admin", () => expect(isAdminRole("manager")).toBe(true));
  it("inspector is not admin", () => expect(isAdminRole("inspector")).toBe(false));
  it("agent is not admin", () => expect(isAdminRole("agent")).toBe(false));
  it("undefined is not admin", () => expect(isAdminRole(undefined)).toBe(false));
  it("null is not admin", () => expect(isAdminRole(null)).toBe(false));
});

describe("assertAdminOrForbidden", () => {
  it("admins pass (forbidden=false)", () => {
    expect(assertAdminOrForbidden("owner")).toEqual({ forbidden: false });
    expect(assertAdminOrForbidden("manager")).toEqual({ forbidden: false });
  });
  it("non-admins are forbidden", () => {
    expect(assertAdminOrForbidden("inspector")).toEqual({ forbidden: true });
    expect(assertAdminOrForbidden("agent")).toEqual({ forbidden: true });
    expect(assertAdminOrForbidden(undefined)).toEqual({ forbidden: true });
    expect(assertAdminOrForbidden(null)).toEqual({ forbidden: true });
  });
});
