// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { RoleCell, seesOnlyAssigned } from "./RoleCell";
import type { Member } from "~/routes/team.shapes";

afterEach(cleanup);

const member = (over: Partial<Member>): Member => ({
  id: "m", name: "Dana", email: "dana@example.com", role: "inspector", status: "active", lastActiveAt: null,
  token: null, expiresAt: null, inviteLink: null, permissionOverrides: null, totpEnabled: false, ...over,
});

describe("seesOnlyAssigned", () => {
  it("is true for an inspector with the restriction stored, false without it (control)", () => {
    expect(seesOnlyAssigned(member({ permissionOverrides: { viewAllInspections: false } }))).toBe(true);
    expect(seesOnlyAssigned(member({}))).toBe(false);
    expect(seesOnlyAssigned(member({ permissionOverrides: { publish: false } }))).toBe(false);
  });
  it("is never true for a role that pins the scope, whatever is stored", () => {
    expect(seesOnlyAssigned(member({ role: "manager", permissionOverrides: { viewAllInspections: false } }))).toBe(false);
    expect(seesOnlyAssigned(member({ role: "staff", permissionOverrides: { viewAllInspections: false } }))).toBe(false);
  });
});

describe("RoleCell", () => {
  it("marks a restricted active inspector 'Assigned only', and an unrestricted one not", () => {
    const restricted = render(<RoleCell member={member({ permissionOverrides: { viewAllInspections: false } })} canManage={false} templates={[]} />);
    expect(restricted.getByText("Assigned only")).toBeTruthy();
    cleanup();
    const open = render(<RoleCell member={member({})} canManage={false} templates={[]} />);
    expect(open.queryByText("Assigned only")).toBeNull();
  });
  it("shows no badge on a pending invite, which has no member row to describe yet", () => {
    const { queryByText } = render(<RoleCell member={member({ status: "pending", permissionOverrides: { viewAllInspections: false } })} canManage={false} templates={[]} />);
    expect(queryByText("Assigned only")).toBeNull();
  });
});
