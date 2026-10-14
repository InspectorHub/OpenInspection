import { describe, it, expect, afterEach, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";

/**
 * The two matching intents of the QuickBooks settings action, driven through
 * the real route with a fetch stub that answers by path.
 */

vi.mock("~/lib/session.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/session.server")>()),
  requireToken: async () => "jwt-from-session",
}));

import { action } from "./settings-integrations-qbo";

const API_URL = "https://mock-api.test";
const BASE = "/api/integrations/qbo";

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

interface Seen { method: string; path: string; search: string; auth: string | null; body: unknown }

function routedFetch(answer: (method: string, path: string) => Response) {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string, init?: RequestInit) => {
    const req = typeof input === "string" ? new Request(input, init) : input;
    const url = new URL(req.url);
    const text = await req.clone().text().catch(() => "");
    seen.push({
      method: req.method, path: url.pathname, search: url.search,
      auth: req.headers.get("Authorization"), body: text ? JSON.parse(text) : null,
    });
    return answer(req.method, url.pathname);
  }));
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function run(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request("https://app.test/settings/integrations/qbo", {
    method: "POST", headers: { Cookie: "__session=x" }, body: form,
  });
  return action({ request, context: createLoadContext({ API_URL }), params: {} } as never) as Promise<Record<string, unknown>>;
}

const faultBody = { success: false, error: { code: "x", message: "<Fault>raw intuit text</Fault>" } };
const refusal = (reason: string, extra: Record<string, unknown> = {}) =>
  jsonResponse(400, { success: false, error: { code: "bad_request", message: "raw server text", details: { reason, ...extra } } });

describe("qbo-search-customers", () => {
  const found = {
    data: {
      customers: [{
        id: "58", displayName: "Amy's Bird Sanctuary", companyName: null, email: "amy@birds.test",
        phone: "555", active: true, linkedContactId: null, linkedContactName: null, syncToken: "7",
      }],
      nextStartPosition: null,
    },
  };

  it("asks the API for the encoded text with the session as a Bearer credential, and returns the rows it understands", async () => {
    const seen = routedFetch(() => jsonResponse(200, found));
    const result = await run({ intent: "qbo-search-customers", q: "  a&b=c d  " });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", path: `${BASE}/customers`, auth: "Bearer jwt-from-session" });
    expect(new URLSearchParams(seen[0].search).get("q")).toBe("a&b=c d");
    expect(result.search).toEqual({
      ok: true,
      customers: [{
        id: "58", displayName: "Amy's Bird Sanctuary", companyName: null, email: "amy@birds.test",
        linkedContactId: null, linkedContactName: null,
      }],
    });
    // Nothing the page does not draw is passed on.
    expect(JSON.stringify(result)).not.toContain("syncToken");
  });

  it("refuses text the API would refuse without calling it (control: valid text is sent)", async () => {
    const seen = routedFetch(() => jsonResponse(200, found));
    for (const q of ["", " a ", "x".repeat(101), "ab\ncd"]) {
      expect((await run({ intent: "qbo-search-customers", q })).search).toEqual({ ok: false, error: "other" });
    }
    expect(seen).toHaveLength(0);
    await run({ intent: "qbo-search-customers", q: "ab" });
    expect(seen).toHaveLength(1);
  });

  it("maps a 429 to rate_limited, whatever the body says", async () => {
    routedFetch(() => jsonResponse(429, faultBody));
    expect((await run({ intent: "qbo-search-customers", q: "amy" })).search).toEqual({ ok: false, error: "rate_limited" });
  });

  it("maps a missing connection to not_connected and anything else to other, never forwarding the body", async () => {
    routedFetch(() => refusal("qbo_not_connected"));
    expect((await run({ intent: "qbo-search-customers", q: "amy" })).search).toEqual({ ok: false, error: "not_connected" });

    routedFetch(() => refusal("qbo_search_rejected"));
    const other = await run({ intent: "qbo-search-customers", q: "amy" });
    expect(other.search).toEqual({ ok: false, error: "other" });
    expect(JSON.stringify(other)).not.toContain("raw server text");

    routedFetch(() => jsonResponse(500, faultBody));
    expect(JSON.stringify(await run({ intent: "qbo-search-customers", q: "amy" }))).not.toContain("Fault");
  });
});

describe("qbo-link-customer", () => {
  it("posts the customer id as JSON to the encoded contact path with the Bearer credential", async () => {
    const seen = routedFetch(() => jsonResponse(200, { success: true, data: { displayName: "Amy's Bird Sanctuary", qboCustomerId: "58" } }));
    const result = await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "POST", path: `${BASE}/contacts/c-1/link`, auth: "Bearer jwt-from-session", body: { qboCustomerId: "58" },
    });
    expect(result).toMatchObject({ success: true, linked: { ok: true, displayName: "Amy's Bird Sanctuary" } });
  });

  it("rejects ids that could change the path without calling the API (control: a plain pair is sent)", async () => {
    const seen = routedFetch(() => jsonResponse(200, { success: true, data: { displayName: "A" } }));
    const bad: Array<[string, string]> = [
      ["../admin", "58"], ["c-1/../x", "58"], ["c 1", "58"], ["", "58"], ["c-1?x=1", "58"], ["c-1#", "58"],
      ["c-1", ""], ["c-1", "5/8"], ["c-1", "58%2f"], ["c-1", "x".repeat(65)],
    ];
    for (const [contactId, qboCustomerId] of bad) {
      const result = await run({ intent: "qbo-link-customer", contactId, qboCustomerId });
      expect(result).toMatchObject({ success: false, linked: { ok: false, reason: "other" } });
    }
    expect(seen).toHaveLength(0);
    await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" });
    expect(seen).toHaveLength(1);
  });

  it("maps each refusal to its reason, with the holder for a taken customer", async () => {
    routedFetch(() => refusal("qbo_customer_taken", { holderName: "Lee Park", holderArchived: true, holderContactId: "c-9" }));
    expect((await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" })).linked)
      .toEqual({ ok: false, reason: "taken", holderName: "Lee Park", holderArchived: true });

    routedFetch(() => refusal("qbo_customer_taken", { holderName: null, holderArchived: false }));
    expect((await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" })).linked)
      .toEqual({ ok: false, reason: "taken" });

    routedFetch(() => refusal("qbo_customer_inactive"));
    expect((await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" })).linked)
      .toEqual({ ok: false, reason: "inactive" });

    routedFetch(() => refusal("qbo_not_connected"));
    expect((await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" })).linked)
      .toEqual({ ok: false, reason: "not_connected" });
  });

  it("maps everything else to other and never forwards a body", async () => {
    for (const answer of [refusal("qbo_customer_not_found"), refusal("qbo_unavailable"), jsonResponse(500, faultBody), jsonResponse(429, faultBody)]) {
      routedFetch(() => answer);
      const result = await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" });
      expect(result).toMatchObject({ success: false, linked: { ok: false, reason: "other" } });
      expect(JSON.stringify(result)).not.toMatch(/raw (server|intuit)/);
    }
  });

  it("answers other when the request itself cannot be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await run({ intent: "qbo-link-customer", contactId: "c-1", qboCustomerId: "58" })).linked)
      .toEqual({ ok: false, reason: "other" });
  });
});
