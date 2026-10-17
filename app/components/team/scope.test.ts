import { describe, it, expect } from "vitest";
import { getCapabilities, TOGGLEABLE } from "../../../server/lib/auth/capabilities";
import { SCOPE_CAPABILITIES, hasScopeChoice, inviteCapabilities, statedScope, withScope } from "./scope";
import { computeOverrideDiff, CAP_GROUPS } from "../modals/InviteSeatDrawer";
import { templateMatchesForm, type TemplateOption } from "./permission-template-ui";

describe("the scope control carries the visibility capability and the capability list carries the rest", () => {
  it("together they cover every toggleable capability exactly once", () => {
    const listed = CAP_GROUPS.flatMap((g) => g.caps);
    expect([...listed, ...SCOPE_CAPABILITIES].sort()).toEqual([...TOGGLEABLE].sort());
    expect(SCOPE_CAPABILITIES).toEqual(["viewAllInspections"]);
    expect(new Set([...listed, ...SCOPE_CAPABILITIES]).size).toBe(TOGGLEABLE.length);
  });
  it("only an inspector can be given a choice", () => {
    expect(["inspector", "manager", "staff", "owner"].map(hasScopeChoice)).toEqual([true, false, false, false]);
  });
});

describe("withScope", () => {
  it("narrowing the scope also drops scheduleOthers, which the server switches off with it", () => {
    const granted = { ...getCapabilities("inspector", null), scheduleOthers: true };
    const narrowed = withScope(granted, false);
    expect(narrowed.viewAllInspections).toBe(false);
    expect(narrowed.scheduleOthers).toBe(false);
    // the other switches are left alone
    expect(narrowed.publish).toBe(true);
  });
  it("widening it changes nothing else (control)", () => {
    const base = getCapabilities("inspector", { viewAllInspections: false });
    expect(withScope(base, true)).toEqual({ ...base, viewAllInspections: true });
  });
});

describe("inviteCapabilities: the company default for new inspectors", () => {
  it("starts an inspector on every inspection when the company default is on (control: today's form)", () => {
    expect(inviteCapabilities("inspector", false)).toEqual(getCapabilities("inspector", null));
  });
  it("starts an inspector on assigned inspections only when the company default is off", () => {
    const caps = inviteCapabilities("inspector", true);
    expect(caps.viewAllInspections).toBe(false);
    expect(caps.scheduleOthers).toBe(false);
  });
  it("leaves a manager or staff alone: their role pins the scope", () => {
    for (const role of ["manager", "staff"] as const) expect(inviteCapabilities(role, true).viewAllInspections).toBe(true);
  });
  it("a template that states the scope wins over the company default", () => {
    expect(inviteCapabilities("inspector", true, { viewAllInspections: true }).viewAllInspections).toBe(true);
    expect(inviteCapabilities("inspector", false, { viewAllInspections: false }).viewAllInspections).toBe(false);
  });
});

describe("what the invite must state", () => {
  it("under a restricting default, choosing 'all inspections' is sent outright", () => {
    const all = getCapabilities("inspector", null);
    expect(statedScope("inspector", all, true)).toEqual({ viewAllInspections: true });
    expect(computeOverrideDiff("inspector", all, true)).toEqual({ viewAllInspections: true });
  });
  it("under a restricting default, leaving it restricted is the ordinary difference from the role", () => {
    const restricted = inviteCapabilities("inspector", true);
    expect(statedScope("inspector", restricted, true)).toEqual({});
    expect(computeOverrideDiff("inspector", restricted, true)).toEqual({ viewAllInspections: false });
  });
  it("where the default is 'all', saying nothing already means all (the request is what it always was)", () => {
    const all = getCapabilities("inspector", null);
    expect(statedScope("inspector", all, false)).toEqual({});
    expect(computeOverrideDiff("inspector", all)).toEqual({});
    expect(computeOverrideDiff("inspector", withScope(all, false))).toEqual({ viewAllInspections: false });
  });
  it("never states a scope for a role that pins it", () => {
    expect(statedScope("manager", getCapabilities("manager", null), true)).toEqual({});
  });
});

describe("a permission template is compared with the scope set beside it", () => {
  const standard: TemplateOption = {
    id: "inspector_standard", system: true, name: "Standard inspector", description: null, baseRole: "inspector", overrides: {},
  };
  it("choosing 'only assigned' does not make the form read Customized", () => {
    const caps = withScope(getCapabilities("inspector", null), false);
    expect(templateMatchesForm(standard, "inspector", caps)).toBe(true);
  });
  it("a real edit still does (control)", () => {
    const caps = { ...withScope(getCapabilities("inspector", null), false), publish: false };
    expect(templateMatchesForm(standard, "inspector", caps)).toBe(false);
  });
});
