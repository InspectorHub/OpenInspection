// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  MODULE_GROUPS,
  visibleModuleGroups,
  roleCanWrite,
  selectedScopesFromForm,
} from "../../../server/lib/mcp/tag-catalog";
import { ConsentForm, isRegisteredRedirectUri, loader, action } from "~/routes/oauth/authorize";
import { createLoadContext } from "~/lib/load-context";

const getToken = vi.hoisted(() => vi.fn());
const sessionGet = vi.hoisted(() => vi.fn());
const writeAuditLog = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session.server", () => ({ getToken }));
vi.mock("~/lib/api-client.server", () => ({
  createApi: () => ({ sessionContext: { context: { $get: sessionGet } } }),
}));
vi.mock("../../../server/lib/audit", () => ({ writeAuditLog }));

// The tags MODULE_GROUPS is allowed to use: the controlled vocabulary from
// docs/develop/conventions/route-metadata.md plus the two real route tags that
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

/* ------------------------------------------------------------------ */
/* The real loader and action, native branch                           */
/* ------------------------------------------------------------------ */

const APP_REDIRECT = "io.inspectorhub.app:/oauth/callback";
const S256 = { codeChallenge: "c".repeat(43), codeChallengeMethod: "S256" };

/** An unsigned JWT whose payload carries what resolveIdentity decodes. */
function jwt(): string {
  const payload = btoa(JSON.stringify({ sub: "u1", "custom:tenantId": "t1" }));
  return `h.${payload}.s`;
}

interface Parsed {
  clientId: string;
  scope: string[];
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

function harness(opts: { native?: boolean; mcp?: boolean; parsed: Parsed }) {
  const completeAuthorization = vi.fn(async (_o: { scope: string[]; props: Record<string, unknown> }) => ({
    redirectTo: `${opts.parsed.redirectUri}?code=abc`,
  }));
  const provider = {
    parseAuthRequest: vi.fn(async () => ({ responseType: "code", state: "s", ...opts.parsed })),
    lookupClient: vi.fn(async () => ({ clientId: "c1", clientName: "Field App", redirectUris: [opts.parsed.redirectUri] })),
    completeAuthorization,
  };
  // MCP is on unless a test says otherwise, as it is on any deployment that serves an MCP grant.
  const env = {
    APP_MODE: "standalone",
    OAUTH_PROVIDER: provider,
    ...(opts.mcp === false ? {} : { MCP_ENABLED: "true" }),
    ...(opts.native ? { NATIVE_CLIENT_ENABLED: "true" } : {}),
  };
  return { provider, completeAuthorization, context: createLoadContext(env) };
}

const getArgs = (context: ReturnType<typeof createLoadContext>, scope: string) => {
  const url = new URL(`https://app.test/oauth/authorize?scope=${scope}`);
  return { request: new Request(url), url, context } as never;
};

beforeEach(() => {
  getToken.mockReset().mockResolvedValue(jwt());
  sessionGet.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { user: { role: "inspector" }, branding: { tenantSlug: "acme" } } }),
  });
  writeAuditLog.mockReset();
});

describe("authorize loader, native branch (the real loader)", () => {
  const good: Parsed = { clientId: "c1", scope: ["native"], redirectUri: APP_REDIRECT, ...S256 };

  it("is 404 when the operator has not opted in, and still serves an MCP request on that deployment", async () => {
    const off = harness({ parsed: good });
    const refused = await loader(getArgs(off.context, "native")).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(404);
    const mcp = harness({ parsed: { clientId: "c1", scope: ["read:inspections"], redirectUri: "https://claude.ai/cb" } });
    const data = await loader(getArgs(mcp.context, "read:inspections"));
    expect(data.native).toBe(false);
  });

  it("native-only deployment: an MCP-scope authorization page is 404, the native one is served", async () => {
    const mcpParsed: Parsed = { clientId: "c1", scope: ["read:inspections"], redirectUri: "https://claude.ai/cb" };
    const nativeOnly = harness({ native: true, mcp: false, parsed: mcpParsed });
    const refused = await loader(getArgs(nativeOnly.context, "read:inspections")).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(404);
    // Control: the same deployment serves a native authorization.
    const ok = harness({ native: true, mcp: false, parsed: good });
    expect((await loader(getArgs(ok.context, "native"))).native).toBe(true);
  });

  it("refuses an agent before showing the consent page, as the action does", async () => {
    sessionGet.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { role: "agent" }, branding: { tenantSlug: "acme" } } }),
    });
    const h = harness({ native: true, parsed: good });
    const err = await loader(getArgs(h.context, "native")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(403);
    // Control: an inspector gets the page.
    sessionGet.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { role: "inspector" }, branding: { tenantSlug: "acme" } } }),
    });
    expect((await loader(getArgs(h.context, "native"))).native).toBe(true);
  });

  it("is 400 for a redirect that is not a private scheme or loopback", async () => {
    const h = harness({ native: true, parsed: { ...good, redirectUri: "https://evil.example/cb" } });
    const err = await loader(getArgs(h.context, "native")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(400);
  });

  it("is 400 without a PKCE S256 challenge (none, or plain) and shows no consent page", async () => {
    const variants: Parsed[] = [
      { clientId: "c1", scope: ["native"], redirectUri: APP_REDIRECT },
      { ...good, codeChallengeMethod: "plain" },
    ];
    for (const parsed of variants) {
      const h = harness({ native: true, parsed });
      const err = await loader(getArgs(h.context, "native")).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(400);
    }
  });

  it("serves the native consent page for a private scheme with S256, and names the scheme", async () => {
    const h = harness({ native: true, parsed: good });
    const data = await loader(getArgs(h.context, "native"));
    expect(data.native).toBe(true);
    expect(data.clientName).toBe("Field App");
    expect(data.redirectScheme).toBe("io.inspectorhub.app");
    expect(data.redirectLoopback).toBe(false);
  });

  it("serves a loopback redirect as 'this computer' rather than a scheme", async () => {
    const h = harness({ native: true, parsed: { ...good, redirectUri: "http://127.0.0.1:53682/cb" } });
    const data = await loader(getArgs(h.context, "native"));
    expect(data.redirectLoopback).toBe(true);
    expect(data.redirectScheme).toBe("");
  });
});

describe("authorize action, native branch (the real action)", () => {
  function post(context: ReturnType<typeof createLoadContext>, authReq: object) {
    const url = new URL("https://app.test/oauth/authorize");
    const body = new URLSearchParams({ oauthReq: JSON.stringify(authReq) });
    return { request: new Request(url, { method: "POST", body }), url, context } as never;
  }
  const base = { responseType: "code", state: "s", clientId: "c1", scope: ["native", "read:inspections"], redirectUri: APP_REDIRECT, ...S256 };

  it("grants only the native scope with native props and redirects with the code", async () => {
    const h = harness({ native: true, parsed: base });
    const res = (await action(post(h.context, base))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP_REDIRECT}?code=abc`);
    const arg = h.completeAuthorization.mock.calls[0]?.[0];
    expect(arg?.scope).toEqual(["native"]);
    expect(arg?.props).toMatchObject({ kind: "native", userId: "u1", tenantId: "t1", role: "inspector" });
  });

  it("is 404 when the flag is off, 400 without S256, and grants nothing in either case", async () => {
    const off = harness({ parsed: base });
    const e1 = await action(post(off.context, base)).catch((e: unknown) => e);
    expect((e1 as Response).status).toBe(404);
    const noPkce = harness({ native: true, parsed: base });
    const e2 = await action(post(noPkce.context, { ...base, codeChallenge: undefined, codeChallengeMethod: undefined })).catch((e: unknown) => e);
    expect((e2 as Response).status).toBe(400);
    expect(off.completeAuthorization).not.toHaveBeenCalled();
    expect(noPkce.completeAuthorization).not.toHaveBeenCalled();
  });

  it("native-only deployment: an MCP-scope authorization is 404 and grants nothing; native still completes", async () => {
    const mcp = { ...base, scope: ["read:inspections"], codeChallenge: undefined, codeChallengeMethod: undefined };
    const h = harness({ native: true, mcp: false, parsed: mcp });
    const refused = await action(post(h.context, mcp)).catch((e: unknown) => e);
    expect((refused as Response).status).toBe(404);
    expect(h.completeAuthorization).not.toHaveBeenCalled();
    // Control: the same deployment completes a native authorization.
    const ok = harness({ native: true, mcp: false, parsed: base });
    expect(((await action(post(ok.context, base))) as Response).status).toBe(302);
    expect(ok.completeAuthorization).toHaveBeenCalledTimes(1);
  });

  it("control: an MCP request still takes the module-scope path", async () => {
    const mcp = { ...base, scope: ["read:inspections"], codeChallenge: undefined, codeChallengeMethod: undefined };
    const h = harness({ parsed: mcp });
    const res = (await action(post(h.context, mcp))) as Response;
    expect(res.status).toBe(302);
    const arg = h.completeAuthorization.mock.calls[0]?.[0];
    expect(arg?.props).not.toHaveProperty("kind");
  });
});
