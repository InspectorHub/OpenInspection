import { describe, it, expect, afterEach, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";

/**
 * What the QuickBooks settings loader works out and what its actions send,
 * driven through the real branches with a fetch stub that answers by path.
 *
 * The component tests next door prove what the page does with this data; this
 * file proves the data itself, because the two halves are only joined by the
 * loader's return type.
 */

vi.mock("~/lib/session.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/session.server")>()),
  requireToken: async () => "jwt-from-session",
}));

import { loader, action } from "./settings-integrations-qbo";

const API_URL = "https://mock-api.test";
const PAGE = "https://app.test/settings/integrations/qbo";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

interface Seen { method: string; path: string; body: unknown }

/** Answers by `METHOD /path`; anything unlisted gets 200 `{ data: {} }`. Records every request. */
function routedFetch(answers: Record<string, () => Response> = {}) {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string, init?: RequestInit) => {
    const req = typeof input === "string" ? new Request(input, init) : input;
    const path = new URL(req.url).pathname;
    let body: unknown = null;
    const text = await req.clone().text().catch(() => "");
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    seen.push({ method: req.method, path, body });
    const answer = answers[`${req.method} ${path}`];
    return answer ? answer() : jsonResponse(200, { data: {} });
  }));
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ctx = (env: Record<string, string> = {}) => createLoadContext({ API_URL, ...env });
const loadAt = (url: string, context = ctx()) =>
  loader({ request: new Request(url, { headers: { Cookie: "__session=x" } }), context, params: {} } as never);

function postIntent(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(PAGE, { method: "POST", headers: { Cookie: "__session=x" }, body: form });
}
const run = (fields: Record<string, string>) =>
  action({ request: postIntent(fields), context: ctx(), params: {} } as never) as Promise<Record<string, unknown>>;

describe("QuickBooks settings route - loader output", () => {
  it("passes the stored credentials through masked, and leaves QBO_ENV out of them", async () => {
    routedFetch({
      "GET /api/admin/secrets": () => jsonResponse(200, { data: { QBO_CLIENT_ID: "AB7B••••••••xyz1", QBO_ENV: "prod••••••••tion" } }),
    });
    const data = await loadAt(PAGE);
    expect(data.secrets).toEqual({ QBO_CLIENT_ID: "AB7B••••••••xyz1", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "" });
    expect(data.secrets).not.toHaveProperty("QBO_ENV");
  });

  it("derives where each setting comes from when nothing is connected, env first", async () => {
    routedFetch({
      "GET /api/admin/secrets": () => jsonResponse(200, { data: { QBO_CLIENT_ID: "AB7B••••••••xyz1", QBO_WEBHOOK_SECRET: "whk1••••••••9999" } }),
    });
    const data = await loadAt(PAGE, ctx({ QBO_CLIENT_ID: "from-env", QBO_CLIENT_SECRET: "sec-env", QBO_ENV: "sandbox" }));
    expect(data.status).toBeNull();
    expect(data.credentialSource).toEqual({
      clientId: "env", // env wins even though a stored value exists
      clientSecret: "env",
      webhookToken: "tenant", // only stored
      environment: "env",
    });
    expect(data.environment).toBe("sandbox");
  });

  it("reads a stored environment from its mask when the env does not set one, and never invents one", async () => {
    routedFetch({ "GET /api/admin/secrets": () => jsonResponse(200, { data: { QBO_ENV: "prod••••••••tion" } }) });
    expect((await loadAt(PAGE)).environment).toBe("production");

    routedFetch();
    const none = await loadAt(PAGE);
    expect(none.environment).toBeNull();
    expect(none.credentialSource.environment).toBe("missing");
  });

  it("does not let a stored value stand in for an env value that is set but not a valid environment", async () => {
    routedFetch({ "GET /api/admin/secrets": () => jsonResponse(200, { data: { QBO_ENV: "prod••••••••tion" } }) });
    const data = await loadAt(PAGE, ctx({ QBO_ENV: "Sandbox" }));
    expect(data.credentialSource.environment).toBe("env");
    expect(data.environment).toBeNull();
  });

  it("uses the connection's own origins and environment once connected", async () => {
    const status = {
      realmId: "1", companyName: "Acme", lastSyncAt: null, syncEnabled: true, openErrors: [],
      paymentDiscrepancies: [], heldDepositCount: 0, refreshTokenExpiresAt: 1, connectedAt: 2,
      environment: "production", mappedCustomers: 3, mappedInvoices: 4,
      credentialSource: { clientId: "tenant", clientSecret: "tenant", webhookToken: "missing", environment: "tenant" },
    };
    routedFetch({ "GET /api/integrations/qbo/status": () => jsonResponse(200, { data: status }) });
    const data = await loadAt(PAGE);
    expect(data.status).toEqual(status);
    expect(data.credentialSource).toEqual(status.credentialSource);
    expect(data.environment).toBe("production");
  });

  it("builds the registration addresses from the public origin, and has none without it", async () => {
    routedFetch();
    const withBase = await loadAt(PAGE, ctx({ APP_BASE_URL: "https://dev.example.com" }));
    expect(withBase.registration?.redirectUri).toBe("https://dev.example.com/api/integrations/qbo/callback");
    expect((await loadAt(PAGE)).registration).toBeNull();
  });

  it("reports a refusal from the API as 'forbidden', not as 'not connected'", async () => {
    routedFetch({
      "GET /api/integrations/qbo/status": () => jsonResponse(403, { error: { message: "forbidden" } }),
      "GET /api/admin/secrets": () => jsonResponse(403, { error: { message: "forbidden" } }),
    });
    expect((await loadAt(PAGE)).access).toBe("forbidden");

    routedFetch();
    expect((await loadAt(PAGE)).access).toBe("ok");
  });

  it("bounds the error code taken from the address to 64 characters", async () => {
    routedFetch();
    const data = await loadAt(`${PAGE}?error=${"x".repeat(200)}`);
    expect(data.oauth.error).toHaveLength(64);
    expect((await loadAt(`${PAGE}?connected=1`)).oauth).toEqual({ connected: true, error: null });
  });
});

describe("QuickBooks settings route - saving credentials", () => {
  const puts = (seen: Seen[]) => seen.filter((s) => s.method === "PUT" && s.path === "/api/admin/secrets");

  it("sends nothing, and still succeeds, when every field was left alone", async () => {
    const seen = routedFetch();
    const result = await run({ intent: "save-qbo-secrets", QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "  ", QBO_WEBHOOK_SECRET: "", QBO_ENV: "" });
    expect(result.success).toBe(true);
    expect(puts(seen)).toHaveLength(0);
  });

  it("sends only what was typed or chosen - an untouched environment is never written", async () => {
    const seen = routedFetch({ "PUT /api/admin/secrets": () => jsonResponse(200, { success: true }) });
    const result = await run({ intent: "save-qbo-secrets", QBO_CLIENT_ID: "new-id", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "", QBO_ENV: "" });
    expect(result.success).toBe(true);
    expect(puts(seen)).toHaveLength(1);
    expect(puts(seen)[0].body).toEqual({ QBO_CLIENT_ID: "new-id" });
  });

  it("does send the environment once one was chosen", async () => {
    const seen = routedFetch({ "PUT /api/admin/secrets": () => jsonResponse(200, { success: true }) });
    await run({ intent: "save-qbo-secrets", QBO_ENV: "production" });
    expect(puts(seen)[0].body).toEqual({ QBO_ENV: "production" });
  });

  it("passes the server's refusal through, such as the environment format gate", async () => {
    routedFetch({
      "PUT /api/admin/secrets": () =>
        jsonResponse(422, { error: { message: 'QBO_ENV must be exactly "sandbox" or "production"' } }),
    });
    const result = await run({ intent: "save-qbo-secrets", QBO_ENV: "Sandbox" });
    expect(result.success).toBe(false);
    expect(result.error).toBe('QBO_ENV must be exactly "sandbox" or "production"');
  });

  it("falls back to a plain message when the refusal has no body", async () => {
    routedFetch({ "PUT /api/admin/secrets": () => jsonResponse(500, null) });
    const result = await run({ intent: "save-qbo-secrets", QBO_CLIENT_ID: "x" });
    expect(result.error).toBe("Failed to save QBO keys.");
  });
});

describe("QuickBooks settings route - the other actions", () => {
  it("dismiss: refuses a missing id without calling the API", async () => {
    const seen = routedFetch();
    const result = await run({ intent: "qbo-dismiss-error" });
    expect(result).toMatchObject({ success: false, error: "Unknown action" });
    expect(seen).toHaveLength(0);
  });

  it("dismiss: encodes the id into the path and hands the id back on success", async () => {
    const seen = routedFetch();
    const result = await run({ intent: "qbo-dismiss-error", errorId: "a/b c" });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /api/integrations/qbo/errors/a%2Fb%20c/dismiss"]);
    expect(result).toMatchObject({ success: true, errorId: "a/b c" });
  });

  it("dismiss: says so, in words about dismissing, when the API refuses", async () => {
    routedFetch({ "POST /api/integrations/qbo/errors/e1/dismiss": () => jsonResponse(404, null) });
    const result = await run({ intent: "qbo-dismiss-error", errorId: "e1" });
    expect(result).toMatchObject({ success: false, error: "Could not dismiss this item. Try again." });
  });

  it("pause: returns the state the server reports, and undefined when it reports none", async () => {
    routedFetch({ "POST /api/integrations/qbo/pause": () => jsonResponse(200, { data: { syncEnabled: false } }) });
    expect(await run({ intent: "qbo-pause" })).toMatchObject({ success: true, syncEnabled: false });

    routedFetch({ "POST /api/integrations/qbo/pause": () => jsonResponse(200, { data: {} }) });
    expect((await run({ intent: "qbo-pause" })).syncEnabled).toBeUndefined();
  });

  it("each failing action names the thing that failed", async () => {
    routedFetch({
      "POST /api/integrations/qbo/sync": () => jsonResponse(500, null),
      "POST /api/integrations/qbo/pause": () => jsonResponse(500, null),
      "POST /api/integrations/qbo/disconnect": () => jsonResponse(500, null),
    });
    expect((await run({ intent: "qbo-sync" })).error).toBe("Could not start the sync. Try again.");
    expect((await run({ intent: "qbo-pause" })).error).toBe("Could not change automatic sync. Try again.");
    expect((await run({ intent: "qbo-disconnect" })).error).toBe("Could not disconnect from QuickBooks. Try again.");
  });

  it("disconnect: posts to the disconnect path and succeeds", async () => {
    const seen = routedFetch();
    expect(await run({ intent: "qbo-disconnect" })).toMatchObject({ success: true });
    expect(seen.map((s) => s.path)).toEqual(["/api/integrations/qbo/disconnect"]);
  });

  it("an unknown or missing intent is refused without any request", async () => {
    const seen = routedFetch();
    expect(await run({ intent: "qbo-nonsense" })).toMatchObject({ success: false, error: "Unknown action" });
    expect(await run({})).toMatchObject({ success: false, error: "Unknown action" });
    expect(seen).toHaveLength(0);
  });
});

describe("QuickBooks settings route - check credentials", () => {
  const CHECK = "POST /api/integrations/qbo/credentials/check";
  const SECRET = "intuit-client-secret-value";
  const answer = (status: number, body: unknown) => ({ [CHECK]: () => jsonResponse(status, body) });
  const errorBody = (code: string, details?: unknown) => ({ success: false, error: { code, message: `server text for ${code}`, details } });

  it.each(["paired", "rejected", "unreachable"] as const)("maps a 200 %s answer through with its time", async (kind) => {
    routedFetch(answer(200, { success: true, data: { result: kind, environment: "sandbox", checkedAt: 1760400000 } }));
    const result = await run({ intent: "qbo-check-credentials" });
    expect(result).toMatchObject({ success: true, intent: "qbo-check-credentials", error: null, check: { kind, checkedAt: 1760400000 } });
  });

  it("sends a bodiless POST to the check path, and takes no credentials from the form", async () => {
    const seen = routedFetch(answer(200, { data: { result: "paired", environment: null, checkedAt: 1 } }));
    await run({ intent: "qbo-check-credentials", QBO_CLIENT_ID: "typed-id", QBO_CLIENT_SECRET: SECRET });
    expect(seen).toEqual([{ method: "POST", path: "/api/integrations/qbo/credentials/check", body: null }]);
  });

  it("names the missing settings when the server declines for them, and drops anything it cannot name", async () => {
    routedFetch(answer(400, errorBody("credentials_missing", ["QBO_CLIENT_SECRET", "SOMETHING_ELSE"])));
    const result = await run({ intent: "qbo-check-credentials" });
    expect(result).toMatchObject({ success: false, check: { kind: "credentials_missing", missing: ["QBO_CLIENT_SECRET"] } });
    expect(JSON.stringify(result)).not.toContain("SOMETHING_ELSE");
    expect(JSON.stringify(result)).not.toContain("server text");
  });

  it("reports a missing public address, a rate limit and a failure each as themselves", async () => {
    routedFetch(answer(400, errorBody("app_base_url_missing")));
    expect(await run({ intent: "qbo-check-credentials" })).toMatchObject({ success: false, check: { kind: "app_base_url_missing" } });

    routedFetch(answer(429, errorBody("rate_limited")));
    expect(await run({ intent: "qbo-check-credentials" })).toMatchObject({ success: false, check: { kind: "rate_limited" } });

    // A 429 whose body is not JSON is still a rate limit.
    routedFetch({ [CHECK]: () => jsonResponse(429, null) });
    expect(await run({ intent: "qbo-check-credentials" })).toMatchObject({ check: { kind: "rate_limited" } });

    for (const status of [401, 403, 500]) {
      routedFetch(answer(status, errorBody("server_error")));
      expect(await run({ intent: "qbo-check-credentials" })).toMatchObject({ success: false, check: { kind: "failed" } });
    }
  });

  it("treats a network failure, and an answer it does not understand, as a failed check - never as a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const down = await run({ intent: "qbo-check-credentials" });
    expect(down).toMatchObject({ success: false, check: { kind: "failed" } });

    routedFetch(answer(200, { success: true, data: { result: "maybe", checkedAt: 1 } }));
    expect(await run({ intent: "qbo-check-credentials" })).toMatchObject({ check: { kind: "failed" } });
    routedFetch(answer(200, { success: true, data: { result: "paired" } }));
    expect(await run({ intent: "qbo-check-credentials" })).toMatchObject({ check: { kind: "failed" } });
  });

  it("returns no credential, whatever the server put in its answer", async () => {
    routedFetch(answer(200, {
      success: true,
      data: { result: "rejected", environment: "sandbox", checkedAt: 5, clientSecret: SECRET, clientId: "leaky-id" },
    }));
    const result = await run({ intent: "qbo-check-credentials", QBO_CLIENT_SECRET: SECRET });
    expect(result.check).toEqual({ kind: "rejected", checkedAt: 5 });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain("leaky-id");
  });
});
