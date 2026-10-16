// @vitest-environment happy-dom
// The authorize loader and action under the 1.x provider: the per-scope redirect
// guard (the provider accepts private-use schemes deployment-wide, this is the
// check that scopes it) and the standard OAuth answer for a request the provider
// refuses to parse.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader, action } from "~/routes/oauth/authorize";
import { createLoadContext } from "~/lib/load-context";

const getToken = vi.hoisted(() => vi.fn());
const sessionGet = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session.server", () => ({ getToken }));
vi.mock("~/lib/api-client.server", () => ({
  createApi: () => ({ sessionContext: { context: { $get: sessionGet } } }),
}));
vi.mock("../../../server/lib/audit", () => ({ writeAuditLog: vi.fn() }));

const S256 = { codeChallenge: "c".repeat(43), codeChallengeMethod: "S256" };

function jwt(): string {
  return `h.${btoa(JSON.stringify({ sub: "u1", "custom:tenantId": "t1" }))}.s`;
}

interface Parsed {
  clientId: string;
  scope: string[];
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

function harness(parsed: Parsed, parseError?: unknown) {
  const completeAuthorization = vi.fn(async () => ({ redirectTo: `${parsed.redirectUri}?code=abc` }));
  const provider = {
    parseAuthRequest: vi.fn(async () => {
      if (parseError) throw parseError;
      return { responseType: "code", state: "s", ...parsed };
    }),
    lookupClient: vi.fn(async () => ({ clientId: "c1", clientName: "Some Client", redirectUris: [parsed.redirectUri] })),
    completeAuthorization,
  };
  const env = { APP_MODE: "standalone", OAUTH_PROVIDER: provider, MCP_ENABLED: "true", NATIVE_CLIENT_ENABLED: "true" };
  return { provider, completeAuthorization, context: createLoadContext(env) };
}

const getArgs = (context: ReturnType<typeof createLoadContext>, scope: string) => {
  const url = new URL(`https://app.test/oauth/authorize?scope=${scope}`);
  return { request: new Request(url), url, context } as never;
};

function post(context: ReturnType<typeof createLoadContext>, authReq: object) {
  const url = new URL("https://app.test/oauth/authorize");
  const body = new URLSearchParams({ oauthReq: JSON.stringify(authReq) });
  return { request: new Request(url, { method: "POST", body }), url, context } as never;
}

const status = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Response).status;

beforeEach(() => {
  getToken.mockReset().mockResolvedValue(jwt());
  sessionGet.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { user: { role: "inspector" }, branding: { tenantSlug: "acme" } } }),
  });
});

describe("authorize loader: per-scope redirect guard", () => {
  const mcp = (redirectUri: string): Parsed => ({ clientId: "c1", scope: ["read:inspections"], redirectUri });

  it("a private-use scheme is served with the native scope and refused without it", async () => {
    const native = harness({ clientId: "c1", scope: ["native"], redirectUri: "io.example.app:/cb", ...S256 });
    expect((await loader(getArgs(native.context, "native"))).native).toBe(true);
    const notNative = harness(mcp("io.example.app:/cb"));
    expect(await status(loader(getArgs(notNative.context, "read:inspections")))).toBe(400);
  });

  it("the editor schemes, https and loopback http are served to an MCP client", async () => {
    for (const uri of ["cursor://anysphere.cursor-retrieval/oauth/callback", "https://client.example/cb", "http://127.0.0.1:6274/callback"]) {
      const h = harness(mcp(uri));
      expect((await loader(getArgs(h.context, "read:inspections"))).native, uri).toBe(false);
    }
  });

  it("javascript: and data: redirects are refused with a standard OAuth error body", async () => {
    for (const uri of ["javascript:alert(1)", "data:text/html,x"]) {
      const h = harness(mcp(uri));
      const res = (await loader(getArgs(h.context, "read:inspections")).catch((e: unknown) => e)) as Response;
      expect(res.status, uri).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
  });

  it("a request the provider refuses to parse (resource naming a slug) is an OAuth error, not a 500", async () => {
    const refusal = Object.assign(new Error("resource"), { code: "invalid_target", description: "The resource parameter must name exactly one configured protected resource", statusCode: 400 });
    const h = harness(mcp("https://client.example/cb"), refusal);
    const res = (await loader(getArgs(h.context, "read:inspections")).catch((e: unknown) => e)) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_target" });
    // Control: an error that is not an OAuth refusal is not swallowed into a 400.
    const boom = harness(mcp("https://client.example/cb"), new TypeError("bug"));
    await expect(loader(getArgs(boom.context, "read:inspections"))).rejects.toBeInstanceOf(TypeError);
  });
});

describe("authorize action: the same guard on the hidden-field request", () => {
  const base = { responseType: "code", state: "s", clientId: "c1", scope: ["read:inspections"] };

  it("refuses a tampered redirect and never completes the authorization", async () => {
    for (const redirectUri of ["javascript:alert(1)", "io.example.app:/cb", "http://client.example/cb"]) {
      const h = harness({ clientId: "c1", scope: ["read:inspections"], redirectUri });
      expect(await status(action(post(h.context, { ...base, redirectUri }))), redirectUri).toBe(400);
      expect(h.completeAuthorization).not.toHaveBeenCalled();
    }
  });

  it("control: an https redirect still completes", async () => {
    const redirectUri = "https://client.example/cb";
    const h = harness({ clientId: "c1", scope: ["read:inspections"], redirectUri });
    const res = (await action(post(h.context, { ...base, redirectUri }))) as Response;
    expect(res.status).toBe(302);
    expect(h.completeAuthorization).toHaveBeenCalledTimes(1);
  });
});
