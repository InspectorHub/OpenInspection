// @vitest-environment happy-dom
/**
 * `/team` with permission templates: each member row says which template their
 * permissions match (or "Custom"), only to people who can manage the team, and
 * the management list appears under the roster for them.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { SYSTEM_TEMPLATES, resolveTemplate } from "../../server/lib/auth/permission-templates";
import TeamPage from "~/routes/team";

const templates = [
  ...SYSTEM_TEMPLATES.map((t) => ({
    id: t.key, system: true, name: t.name, description: t.description, baseRole: t.baseRole,
    overrides: resolveTemplate(t.key).permissionOverrides ?? {},
  })),
  { id: "co-1", system: false, name: "Weekend helper", description: null, baseRole: "inspector", overrides: { publish: false } },
];

const member = (id: string, role: string, permissionOverrides: Record<string, boolean> | null) => ({
  id, name: id, email: `${id}@example.com`, role, status: "active" as const, lastActiveAt: null,
  token: null, expiresAt: null, inviteLink: null, permissionOverrides, totpEnabled: false,
});

function renderTeam(data: Record<string, unknown>) {
  const Stub = createRoutesStub([{ path: "/team", Component: TeamPage, loader: () => data }]);
  return render(<Stub initialEntries={["/team"]} />);
}

const BASE = {
  members: [
    member("ada", "inspector", null),
    member("bo", "inspector", { publish: false }),
    member("cy", "inspector", { scheduleOthers: true, deleteInspection: false }),
    member("di", "owner", null),
  ],
  templates, canManage: true, isOwner: true, loadFailed: false,
};

describe("/team - permission templates", () => {
  it("names the template each member matches, says Custom for the rest, and nothing for the owner", async () => {
    renderTeam(BASE);
    await screen.findByText("ada@example.com");
    // Built-in match, company match (preferred over nothing), custom, and no line for an owner.
    expect(screen.getAllByText("Inspector").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Weekend helper").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Custom")).toHaveLength(1);
  });

  it("lists the company's templates under the roster for someone who can manage the team", async () => {
    renderTeam(BASE);
    expect(await screen.findByRole("heading", { name: "Permission templates" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("shows neither the badges nor the list to someone who cannot manage the team (control for the above)", async () => {
    renderTeam({ ...BASE, canManage: false, templates: [] });
    await screen.findByText("ada@example.com");
    expect(screen.queryByText("Custom")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Permission templates" })).toBeNull();
  });

  it("says nothing about templates when the list did not load (the roster is still there)", async () => {
    renderTeam({ ...BASE, templates: [] });
    await screen.findByText("ada@example.com");
    expect(screen.queryByText("Custom")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Permission templates" })).toBeNull();
  });
});
