// @vitest-environment node
/**
 * The emailed agent sign-in link opens a page; the single-use code is spent by the POST behind its Continue button, not by opening the link.
 * Driven through the page's loader and action with the real redeem handler and a real (in-memory) key-value store behind it.
 */
import { describe, it, expect, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { loader, action } from "~/routes/agent/magic-login";
import { createLoadContext } from "~/lib/load-context";
import { forInProcessApi } from "../../../workers/inprocess-request";
import { agentMagicLoginRedeemRoutes } from "../../../server/api/agent/magic-login";
import { MAGIC_LOGIN_KV_PREFIX } from "../../../server/services/agent/magic-login.service";
import { AppError } from "../../../server/lib/errors";
import { MockKV } from "../../../tests/unit/mocks";

vi.mock("../../../server/services/agent/account", () => ({
  findGlobalAgentById: async (_db: unknown, id: string) => (id === "agent-1" ? { id, email: "agent@example.com" } : null),
}));
vi.mock("../../../server/lib/jwt-keyring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/lib/jwt-keyring")>();
  return { ...actual, signJwt: async () => "signed.agent.token" };
});

function setup(limit = 50) {
  const kv = new MockKV();
  const counts = new Map<string, number>();
  const env = {
    TENANT_CACHE: kv,
    DB: {},
    RATE_LIMITER: { limit: async ({ key }: { key: string }) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return { success: n <= limit }; } },
  };
  const app = new OpenAPIHono();
  app.onError((err, c) => c.json({ error: err.message }, err instanceof AppError ? (err.status as 429) : 500));
  app.use("*", async (c, next) => { c.set("keyringPromise" as never, Promise.resolve({}) as never); await next(); });
  app.route("/", agentMagicLoginRedeemRoutes);
  const mint = async (code: string, userId = "agent-1") => { await kv.put(`${MAGIC_LOGIN_KV_PREFIX}${code}`, JSON.stringify({ userId })); };
  const visit = (code: string, method: "GET" | "POST", ip = "203.0.113.1", extra: Record<string, string> = {}) => {
    const outer = new Request(`https://app.test/agent/magic-login?code=${encodeURIComponent(code)}`, { method, headers: { "cf-connecting-ip": ip, ...extra } });
    const context = createLoadContext({
      API_URL: "https://app.test",
      API_WORKER: { fetch: async (req: Request) => app.fetch(forInProcessApi(req, outer.headers), env) },
    } as never);
    return { outer, context };
  };
  return { kv, mint, visit };
}

describe("agent sign-in link through the page", () => {
  it("a GET never spends the code; the POST signs in once and the second POST goes to the expired-link message", async () => {
    const { kv, mint, visit } = setup();
    await mint("code-1");
    const page = visit("code-1", "GET");
    expect(await loader({ request: page.outer, context: page.context } as never)).toEqual({});
    expect(kv.delete).not.toHaveBeenCalled();

    const first = visit("code-1", "POST");
    const ok = (await action({ request: first.outer, context: first.context } as never)) as Response;
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/agent-dashboard");
    expect(ok.headers.get("set-cookie") ?? "").toContain("__Host-inspector_token=");

    const second = visit("code-1", "POST");
    const again = (await action({ request: second.outer, context: second.context } as never)) as Response;
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toBe("/agent-login?error=expired_link");
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("a GET without a code goes to the sign-in page", async () => {
    const { visit } = setup();
    const page = visit("", "GET");
    let thrown: unknown;
    try { await loader({ request: new Request("https://app.test/agent/magic-login"), context: page.context } as never); } catch (err) { thrown = err; }
    expect((thrown as Response).headers.get("location")).toBe("/agent-login");
  });

  it("over the limit the page shows a limit, not an expired link, and the code is not spent", async () => {
    const { kv, mint, visit } = setup(1);
    await mint("code-2");
    // The first call of this caller uses the allowance on a different, unknown code; the next is over the limit.
    const spent = visit("unknown-code", "POST");
    await action({ request: spent.outer, context: spent.context } as never);
    const over = visit("code-2", "POST");
    expect(await action({ request: over.outer, context: over.context } as never)).toEqual({ rateLimited: true });
    expect(await kv.get(`${MAGIC_LOGIN_KV_PREFIX}code-2`)).not.toBeNull();
    // Another caller still signs in.
    const other = visit("code-2", "POST", "203.0.113.9");
    expect(((await action({ request: other.outer, context: other.context } as never)) as Response).headers.get("location")).toBe("/agent-dashboard");
  });

  it("a POST from another site goes to the expired-link message and does not spend the code; the same POST from our own page signs in", async () => {
    const { kv, mint, visit } = setup();
    await mint("code-3");
    for (const extra of [{ "sec-fetch-site": "cross-site" } as Record<string, string>, { origin: "https://evil.example" }, { "sec-fetch-site": "same-site" }]) {
      const attack = visit("code-3", "POST", "203.0.113.1", extra);
      const res = (await action({ request: attack.outer, context: attack.context } as never)) as Response;
      expect(res.headers.get("location")).toBe("/agent-login?error=expired_link");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(await kv.get(`${MAGIC_LOGIN_KV_PREFIX}code-3`)).not.toBeNull();
    const own = visit("code-3", "POST", "203.0.113.1", { "sec-fetch-site": "same-origin", origin: "https://app.test" });
    expect(((await action({ request: own.outer, context: own.context } as never)) as Response).headers.get("location")).toBe("/agent-dashboard");
  });
});
