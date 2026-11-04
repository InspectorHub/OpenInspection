// @vitest-environment node
/**
 * The sign-in page's action calls the API in-process, the way every loader and action does. Two properties only show up on that path:
 *
 *   1. The API's per-address limiter must see the VISITOR's address. The in-process request is built by server code and carries none
 *      of the browser's headers, so unless the worker entry hands the address on, every visitor shares one bucket.
 *   2. A GET must never spend the single-use link; only the POST does, once.
 *
 * `forInProcessApi` is the same function workers/app.ts puts around the in-process binding.
 */
import { describe, it, expect, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { loader, action } from "~/routes/public/portal-auth";
import { createLoadContext } from "~/lib/load-context";
import { forInProcessApi } from "../../../workers/inprocess-request";
import portalRoutes from "../../../server/api/portal";
import { signMagicLink } from "../../../server/lib/portal-session";
import { AppError } from "../../../server/lib/errors";
import { MockKV } from "../../../tests/unit/mocks";

vi.mock("../../../server/services/agent/account", () => ({ findGlobalAgentByEmail: async () => null }));

const SECRET = "test-jwt-secret";

function setup(opts: { forward: boolean; limit?: number }) {
  const kv = new MockKV();
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const env = {
    JWT_SECRET: SECRET,
    TENANT_CACHE: kv,
    RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return { success: n <= (opts.limit ?? 2) };
      },
    },
  };
  const app = new OpenAPIHono();
  app.onError((err, c) => c.json({ error: err.message }, err instanceof AppError ? (err.status as 429) : 500));
  app.use("*", async (c, next) => {
    c.set("tenantId" as never, "t1" as never);
    c.set("requestedTenantSlug" as never, "acme" as never);
    c.set("services" as never, { portal: { hasLiveClientGrant: async () => true } } as never);
    await next();
  });
  app.route("/api/portal", portalRoutes);
  /** A visitor's page POST: the OUTER request carries the address, the in-process request does not. */
  const visit = (address: string, link: string, method = "POST", extra: Record<string, string> = {}) => {
    const outer = new Request(`https://app.test/portal/acme/auth?link=${encodeURIComponent(link)}`, {
      method, headers: { "cf-connecting-ip": address, ...extra },
    });
    const context = createLoadContext({
      API_URL: "https://app.test",
      API_WORKER: {
        fetch: async (req: Request) => app.fetch(opts.forward ? forInProcessApi(req, outer.headers) : req, env),
      },
    } as never);
    return { outer, context };
  };
  return { kv, keys, visit };
}

describe("portal sign-in through the page", () => {
  it("gives two visitors separate allowances and limits the same visitor", async () => {
    const { visit, keys } = setup({ forward: true, limit: 2 });
    const run = async (address: string) => {
      const { outer, context } = visit(address, "garbage");
      return (await action({ params: { tenant: "acme" }, request: outer, context } as never)) as { rateLimited: boolean; expired: boolean };
    };
    expect((await run("203.0.113.1")).rateLimited).toBe(false);
    expect((await run("203.0.113.1")).rateLimited).toBe(false);
    expect((await run("203.0.113.1")).rateLimited).toBe(true);
    // Another visitor is unaffected by the first one's junk.
    expect((await run("203.0.113.2")).rateLimited).toBe(false);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.includes("203.0.113."))).toBe(true);
  });

  it("control: without the hand-over every visitor lands in one bucket", async () => {
    const { visit, keys } = setup({ forward: false, limit: 2 });
    for (const address of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
      const { outer, context } = visit(address, "garbage");
      await action({ params: { tenant: "acme" }, request: outer, context } as never);
    }
    expect(new Set(keys)).toEqual(new Set(["portal-redeem:unknown"]));
  });

  it("a GET never writes the used-link marker; the POST redeems once and the second POST is refused", async () => {
    const { visit, kv } = setup({ forward: true, limit: 50 });
    const link = await signMagicLink(SECRET, "a@x.com");
    const page = visit("203.0.113.1", link, "GET");
    expect(await loader({ params: { tenant: "acme" }, request: page.outer, context: page.context } as never)).toEqual({ tenant: "acme" });
    expect(kv.put).not.toHaveBeenCalled();

    const first = visit("203.0.113.1", link);
    const ok = (await action({ params: { tenant: "acme" }, request: first.outer, context: first.context } as never)) as Response;
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/portal/acme");
    expect(kv.put).toHaveBeenCalledTimes(1);

    const second = visit("203.0.113.1", link);
    expect(await action({ params: { tenant: "acme" }, request: second.outer, context: second.context } as never))
      .toEqual({ expired: true, rateLimited: false, tenant: "acme" });
  });

  it("a POST from another site is answered like an expired link and does not spend the link; the same POST from our own page works", async () => {
    const { visit, kv } = setup({ forward: true, limit: 50 });
    const link = await signMagicLink(SECRET, "a@x.com");
    for (const extra of [{ "sec-fetch-site": "cross-site" } as Record<string, string>, { origin: "https://evil.example" }, { "sec-fetch-site": "same-site" }]) {
      const attack = visit("203.0.113.1", link, "POST", extra);
      expect(await action({ params: { tenant: "acme" }, request: attack.outer, context: attack.context } as never))
        .toEqual({ expired: true, rateLimited: false, tenant: "acme" });
    }
    expect(kv.put).not.toHaveBeenCalled();
    const own = visit("203.0.113.1", link, "POST", { "sec-fetch-site": "same-origin", origin: "https://app.test" });
    const ok = (await action({ params: { tenant: "acme" }, request: own.outer, context: own.context } as never)) as Response;
    expect(ok.status).toBe(302);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });
});
