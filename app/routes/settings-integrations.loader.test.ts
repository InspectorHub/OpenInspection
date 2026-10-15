import { describe, it, expect, afterEach, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";

/**
 * The Integrations hub draws the cards the overview API returns. The loader
 * asks for them exactly once, alongside its other reads, and a failed overview
 * must not take the Stripe and video panels down with it.
 */

vi.mock("~/lib/session.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/session.server")>()),
  requireToken: async () => "jwt-from-session",
}));
vi.mock("~/lib/access.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/access.server")>()),
  requireAdminLoader: async () => ({ forbidden: false, token: "jwt-from-session" }),
}));

import { loader } from "./settings-integrations";

const API_URL = "https://mock-api.test";
const CARD = {
  id: "email", category: "messaging", status: "not_connected", source: "own",
  canUseOwn: true, detailPath: "/settings/integrations/email", reasonKey: null,
};

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status, ok: status >= 200 && status < 300, headers: { get: () => null },
    json: async () => JSON.parse(text), text: async () => text,
  } as unknown as Response;
}

function stubApi(overview: () => Response) {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string) => {
    const path = typeof input === "string" ? input : new URL(input.url).pathname;
    paths.push(path);
    if (path === "/api/integrations/overview") return overview();
    return jsonResponse(200, { data: {} });
  }));
  return paths;
}
const run = () => loader({
  request: new Request("https://app.test/settings/integrations", { headers: { Cookie: "__session=x" } }),
  context: createLoadContext({ API_URL }), params: {},
} as never);

afterEach(() => { vi.unstubAllGlobals(); });

describe("settings-integrations loader", () => {
  it("returns the overview cards and asks for them once", async () => {
    const paths = stubApi(() => jsonResponse(200, { success: true, data: [CARD] }));
    const data = await run();
    expect("forbidden" in data).toBe(false);
    expect((data as { cards: unknown[] }).cards).toEqual([CARD]);
    expect(paths.filter((p) => p === "/api/integrations/overview")).toHaveLength(1);
  });

  it("reads a failed overview as no cards and still returns the rest of the page", async () => {
    stubApi(() => jsonResponse(500, { success: false }));
    const data = await run() as { cards: unknown[]; webhookBase: string };
    expect(data.cards).toEqual([]);
    expect(data.webhookBase).toBe("https://app.test/webhooks/stripe");
  });
});
