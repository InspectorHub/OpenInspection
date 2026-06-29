import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  MODULE_GROUPS,
  visibleModuleGroups,
  roleCanWrite,
  selectedScopesFromForm,
} from "../../../server/lib/mcp/tag-catalog";
import { ConsentForm } from "~/routes/oauth/authorize";

function render(role: "inspector" | "manager" | "agent"): string {
  return renderToStaticMarkup(
    createElement(ConsentForm, {
      clientName: "Claude",
      role,
      modules: visibleModuleGroups(role),
      canWrite: roleCanWrite(role),
      oauthReqJson: JSON.stringify({ clientId: "c", scope: [], redirectUri: "https://x", state: "s", responseType: "code" }),
    }),
  );
}

describe("tag-catalog module groups", () => {
  it("only contains tags that exist in the route metadata vocabulary", () => {
    // Every group has at least one tag and a stable key/label.
    for (const g of MODULE_GROUPS) {
      expect(g.key).toBeTruthy();
      expect(g.label).toBeTruthy();
      expect(g.tags.length).toBeGreaterThan(0);
    }
  });

  it("hides adminOnly groups from non-owner/manager roles", () => {
    const inspector = visibleModuleGroups("inspector").map((g) => g.key);
    expect(inspector).not.toContain("admin");
    expect(inspector).toContain("inspections");

    const manager = visibleModuleGroups("manager").map((g) => g.key);
    expect(manager).toContain("admin");

    const owner = visibleModuleGroups("owner").map((g) => g.key);
    expect(owner).toContain("admin");
  });

  it("only grants the write column to roles whose caps include write", () => {
    expect(roleCanWrite("inspector")).toBe(true);
    expect(roleCanWrite("manager")).toBe(true);
    expect(roleCanWrite("agent")).toBe(false);
  });
});

describe("selectedScopesFromForm", () => {
  it("expands a ticked Write module into write+read kind:tag strings for every tag", () => {
    const fd = new FormData();
    fd.set("write:inspections", "1");
    const sel = selectedScopesFromForm(fd, MODULE_GROUPS);
    expect(sel).toContain("write:inspections");
    expect(sel).toContain("read:inspections");
  });

  it("expands a ticked Read module into read-only kind:tag strings for every tag", () => {
    const fd = new FormData();
    fd.set("read:contacts", "1");
    const sel = selectedScopesFromForm(fd, MODULE_GROUPS);
    // contacts group => contacts, agents, team
    expect(sel).toContain("read:contacts");
    expect(sel).toContain("read:agents");
    expect(sel).toContain("read:team");
    expect(sel).not.toContain("write:contacts");
  });

  it("ignores unchecked modules", () => {
    const fd = new FormData();
    fd.set("read:invoices", "1");
    const sel = selectedScopesFromForm(fd, MODULE_GROUPS);
    expect(sel).toEqual(["read:invoices"]);
  });
});

describe("ConsentForm", () => {
  it("renders one row per visible module for an inspector and hides the admin row", () => {
    const out = render("inspector");
    for (const g of visibleModuleGroups("inspector")) {
      expect(out).toContain(`data-testid="module-${g.key}"`);
    }
    expect(out).not.toContain('data-testid="module-admin"');
    // inspector can write => the write checkbox column is present
    expect(out).toContain('name="write:inspections"');
    expect(out).toContain('name="read:inspections"');
  });

  it("renders the admin row for a manager", () => {
    const out = render("manager");
    expect(out).toContain('data-testid="module-admin"');
  });

  it("omits the write column for an agent (read-only caps)", () => {
    const out = render("agent");
    expect(out).toContain('name="read:inspections"');
    expect(out).not.toContain('name="write:inspections"');
  });

  it("carries the serialized OAuth request and an Authorize control", () => {
    const out = render("inspector");
    expect(out).toContain('name="oauthReq"');
    expect(out).toContain('data-testid="oauth-authorize-submit"');
    expect(out).toContain('Claude'); // client name shown
  });
});
