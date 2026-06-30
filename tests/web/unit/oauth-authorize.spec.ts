import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  MODULE_GROUPS,
  visibleModuleGroups,
  roleCanWrite,
  selectedScopesFromForm,
} from "../../../server/lib/mcp/tag-catalog";
import { ConsentForm, isRegisteredRedirectUri } from "~/routes/oauth/authorize";

// The tags MODULE_GROUPS is allowed to use: the controlled vocabulary from
// docs/developers/07_route_metadata.md plus the two real route tags that
// predate that prose list (verified present in server/api/** metadata).
const KNOWN_TAGS = new Set<string>([
  // primary vocabulary (07_route_metadata.md)
  "auth", "inspections", "bookings", "templates", "team", "agents", "ai",
  "invoices", "services", "messages", "notifications", "contacts", "metrics",
  "admin", "sysadmin", "audit", "marketplace", "recommendations", "agreements",
  "webhooks", "public", "calendar", "tags", "ratings", "guest", "profile",
  "identity", "automations", "integrations", "qbo",
  // real route tags not yet in the prose vocabulary list
  "sms", "contractor-types",
]);

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
  it("have a non-empty key, label and tags, with every tag in the controlled vocabulary", () => {
    for (const g of MODULE_GROUPS) {
      expect(g.key).toBeTruthy();
      expect(g.label).toBeTruthy();
      expect(g.tags.length).toBeGreaterThan(0);
      for (const tag of g.tags) {
        expect(KNOWN_TAGS, `tag "${tag}" in group "${g.key}"`).toContain(tag);
      }
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

describe("isRegisteredRedirectUri (cancel-path open-redirect guard)", () => {
  const client = {
    clientId: "c",
    redirectUris: ["https://app.example.com/callback", "https://app.example.com/cb2"],
    tokenEndpointAuthMethod: "none",
  };

  it("accepts a redirect URI that is registered to the client", () => {
    expect(isRegisteredRedirectUri(client, "https://app.example.com/callback")).toBe(true);
  });

  it("rejects a tampered/unregistered redirect URI", () => {
    expect(isRegisteredRedirectUri(client, "https://evil.test/steal")).toBe(false);
    // exact match only — no prefix / substring escape
    expect(isRegisteredRedirectUri(client, "https://app.example.com/callback.evil.test")).toBe(false);
  });

  it("rejects when the client is missing (unknown clientId)", () => {
    expect(isRegisteredRedirectUri(null, "https://app.example.com/callback")).toBe(false);
    expect(isRegisteredRedirectUri(undefined, "https://app.example.com/callback")).toBe(false);
  });
});
