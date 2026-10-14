import { describe, it, expect, afterEach, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";
import { loadContactQbo, runContactQboIntent } from "./contact-qbo.server";

/**
 * The contact page's QuickBooks section on the server: who may trigger the two
 * reads, how any failure degrades, and the three intents the action runs. A fetch
 * stub answers by path, so the real helpers build the real requests.
 */

const API_URL = "https://mock-api.test";
const QBO = "/api/integrations/qbo";

function jsonResponse(status: number, body?: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => {
      if (body === undefined) throw new SyntaxError("empty body");
      return JSON.parse(text);
    },
    text: async () => text,
  } as unknown as Response;
}

interface Seen { method: string; path: string; body: unknown }

function routedFetch(answer: (method: string, path: string) => Response | Promise<Response>, quiet = false) {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string, init?: RequestInit) => {
    const req = typeof input === "string" ? new Request(input, init) : input;
    const url = new URL(req.url);
    const text = await req.clone().text().catch(() => "");
    if (!(quiet && url.pathname === "/api/session/context")) {
      seen.push({ method: req.method, path: url.pathname, body: text ? JSON.parse(text) : null });
    }
    return answer(req.method, url.pathname);
  }));
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const context = () => createLoadContext({ API_URL });
const request = () => new Request("https://app.test/contacts/c-1", { headers: { Cookie: "__session=x" } });
const qboCalls = (seen: Seen[]) => seen.filter((s) => s.path.startsWith(QBO));

const STATUS = { success: true, data: { realmId: "1", syncEnabled: true } };
const LINK = { success: true, data: { linked: true, qboCustomerId: "58", displayName: "Amy Co", openErrorCount: 2 } };

/** An API where the signed-in user has `role` and QuickBooks is connected. */
function connectedApi(role: string | null) {
  return routedFetch((_method, path) => {
    if (path === "/api/session/context") {
      return role ? jsonResponse(200, { data: { user: { role } } }) : jsonResponse(401, {});
    }
    if (path === `${QBO}/status`) return jsonResponse(200, STATUS);
    if (path === `${QBO}/contacts/c-1/link`) return jsonResponse(200, LINK);
    return jsonResponse(404, {});
  });
}

describe("loadContactQbo: who triggers the reads", () => {
  it.each(["owner", "manager"])("reads the status and the contact's match for a %s, in parallel", async (role) => {
    const seen = connectedApi(role);
    const result = await loadContactQbo(context(), request(), "jwt", "c-1");
    expect(result).toEqual({
      connected: true,
      link: { linked: true, qboCustomerId: "58", displayName: "Amy Co", openErrorCount: 2 },
    });
    expect(qboCalls(seen).map((s) => `${s.method} ${s.path}`).sort()).toEqual([
      `GET ${QBO}/contacts/c-1/link`,
      `GET ${QBO}/status`,
    ]);
  });

  it.each(["inspector", "agent", "unknown-role", null])("never calls QuickBooks for a %s", async (role) => {
    const seen = connectedApi(role);
    const result = await loadContactQbo(context(), request(), "jwt", "c-1");
    expect(result.connected).toBe(false);
    expect(qboCalls(seen)).toHaveLength(0);
    // Control: the stub does answer QuickBooks for an owner, so the zero above is the gate and not a dead stub.
    const control = connectedApi("owner");
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(true);
    expect(qboCalls(control)).toHaveLength(2);
  });

  it("does not call QuickBooks when the role lookup itself throws", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Request | string) => {
      seen.push(new URL(typeof input === "string" ? input : input.url).pathname);
      throw new TypeError("fetch failed");
    }));
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(false);
    expect(seen.filter((p) => p.startsWith(QBO))).toHaveLength(0);
  });

  it("refuses an id that could change the path without calling QuickBooks (control: a plain id is sent)", async () => {
    const seen = connectedApi("owner");
    for (const id of ["../admin", "c 1", "c-1?x=1", ""]) {
      expect((await loadContactQbo(context(), request(), "jwt", id)).connected).toBe(false);
    }
    expect(qboCalls(seen)).toHaveLength(0);
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(true);
  });
});

describe("loadContactQbo: failures degrade to not connected", () => {
  const owner = (over: (path: string) => Response | null) =>
    routedFetch((_m, path) => {
      if (path === "/api/session/context") return jsonResponse(200, { data: { user: { role: "owner" } } });
      return over(path) ?? jsonResponse(200, path.endsWith("/status") ? STATUS : LINK);
    });

  it("treats a missing connection (data: null) as not connected, even though the link read answered", async () => {
    owner((p) => (p.endsWith("/status") ? jsonResponse(200, { success: true, data: null }) : null));
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(false);
  });

  it.each([401, 403, 404, 500])("treats a %s from the status read as not connected", async (status) => {
    owner((p) => (p.endsWith("/status") ? jsonResponse(status, { error: { message: "<Fault>raw</Fault>" } }) : null));
    expect(await loadContactQbo(context(), request(), "jwt", "c-1")).toEqual({
      connected: false,
      link: { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 },
    });
  });

  it.each([403, 404, 500])("treats a %s from the match read as not connected", async (status) => {
    owner((p) => (p.endsWith("/link") ? jsonResponse(status, {}) : null));
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(false);
  });

  it("treats a malformed match as not connected rather than guessing", async () => {
    owner((p) => (p.endsWith("/link") ? jsonResponse(200, { data: { linked: "yes", openErrorCount: "2" } }) : null));
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(false);
  });

  it("does not throw on a network failure or an unreadable body", async () => {
    routedFetch((_m, path) => {
      if (path === "/api/session/context") return jsonResponse(200, { data: { user: { role: "owner" } } });
      throw new TypeError("fetch failed");
    });
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(false);

    owner((p) => (p.endsWith("/status") ? jsonResponse(200) : null));
    expect((await loadContactQbo(context(), request(), "jwt", "c-1")).connected).toBe(false);
  });

  it("reads an unmatched contact as connected with no match", async () => {
    owner((p) =>
      p.endsWith("/link")
        ? jsonResponse(200, { data: { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 } })
        : null);
    expect(await loadContactQbo(context(), request(), "jwt", "c-1")).toEqual({
      connected: true,
      link: { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 },
    });
  });
});

describe("runContactQboIntent", () => {
  // The action checks the role first; every test here is an owner unless it says otherwise.
  const api = (answer: (method: string, path: string) => Response | Promise<Response>) =>
    routedFetch((m, p) => (p === "/api/session/context" ? jsonResponse(200, { data: { user: { role: "owner" } } }) : answer(m, p)), true);
  const run = (intent: string, fields: Record<string, string> = {}, contactId = "c-1") => {
    const fd = new FormData();
    fd.set("intent", intent);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return runContactQboIntent(context(), request(), "jwt", contactId, intent, fd) as Promise<Record<string, unknown> | null>;
  };

  it("returns null for any other intent, without calling the API", async () => {
    const seen = api(() => jsonResponse(200, {}));
    expect(await run("revoke-access")).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("removes the match of the contact in the route, never one named in the form body", async () => {
    const seen = api(() => jsonResponse(200, { success: true, data: { removed: true } }));
    const result = await run("qbo-unlink-customer", { contactId: "someone-else" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "DELETE", path: `${QBO}/contacts/c-1/link` });
    expect(result).toMatchObject({ success: true, intent: "qbo-unlink-customer", unlinked: { ok: true } });
  });

  it("treats removing an already-absent match, and an empty 204, as done", async () => {
    api(() => jsonResponse(200, { success: true, data: { removed: false } }));
    expect(await run("qbo-unlink-customer")).toMatchObject({ unlinked: { ok: true } });
    api(() => jsonResponse(204));
    expect(await run("qbo-unlink-customer")).toMatchObject({ unlinked: { ok: true } });
  });

  it("refuses a route id that could change the path (control: a plain id is sent)", async () => {
    const seen = api(() => jsonResponse(200, { data: { removed: true } }));
    expect(await run("qbo-unlink-customer", {}, "../admin")).toMatchObject({ success: false, unlinked: { ok: false, reason: "other" } });
    expect(seen).toHaveLength(0);
    await run("qbo-unlink-customer");
    expect(seen).toHaveLength(1);
  });

  it("maps failures to a typed reason and forwards no body", async () => {
    api(() => jsonResponse(409, { success: false, error: { message: "raw server text", details: { reason: "qbo_not_connected" } } }));
    expect(await run("qbo-unlink-customer")).toMatchObject({ success: false, unlinked: { ok: false, reason: "not_connected" } });

    api(() => jsonResponse(500, { error: { message: "<Fault>raw intuit text</Fault>" } }));
    const other = await run("qbo-unlink-customer");
    expect(other).toMatchObject({ success: false, unlinked: { ok: false, reason: "other" } });
    expect(JSON.stringify(other)).not.toMatch(/raw|Fault/);

    api(() => jsonResponse(403, {}));
    expect(await run("qbo-unlink-customer")).toMatchObject({ unlinked: { ok: false, reason: "other" } });

    api((_m, p) => { if (p.startsWith(QBO)) throw new TypeError("fetch failed"); return jsonResponse(200, {}); });
    expect(await run("qbo-unlink-customer")).toMatchObject({ unlinked: { ok: false, reason: "other" } });
  });

  it("matches the contact in the route even when the form names another", async () => {
    const seen = api(() => jsonResponse(200, { success: true, data: { displayName: "Amy Co" } }));
    const result = await run("qbo-link-customer", { contactId: "someone-else", qboCustomerId: "58" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", path: `${QBO}/contacts/c-1/link`, body: { qboCustomerId: "58" } });
    expect(result).toMatchObject({ success: true, linked: { ok: true, displayName: "Amy Co" } });
  });

  it.each(["inspector", "agent", "unknown-role"])("never reaches QuickBooks from any of the three intents for a %s", async (role) => {
    const seen = routedFetch((_m, p) =>
      p === "/api/session/context" ? jsonResponse(200, { data: { user: { role } } }) : jsonResponse(200, { data: { removed: true } }), true);
    for (const intent of ["qbo-unlink-customer", "qbo-link-customer", "qbo-search-customers"]) {
      expect(await run(intent, { q: "amy", qboCustomerId: "58" })).toMatchObject({ success: false });
    }
    expect(qboCalls(seen)).toHaveLength(0);
    // Control: the same three, as an owner, do reach it.
    api(() => jsonResponse(200, { data: { removed: true } }));
    const ownerSeen = routedFetch((_m, p) =>
      p === "/api/session/context" ? jsonResponse(200, { data: { user: { role: "owner" } } }) : jsonResponse(200, { data: { removed: true } }), true);
    for (const intent of ["qbo-unlink-customer", "qbo-link-customer", "qbo-search-customers"]) await run(intent, { q: "amy", qboCustomerId: "58" });
    expect(qboCalls(ownerSeen)).toHaveLength(3);
  });

  it("does not reach QuickBooks when the role lookup throws", async () => {
    const seen = routedFetch((_m, p) => {
      if (p === "/api/session/context") throw new TypeError("fetch failed");
      return jsonResponse(200, {});
    }, true);
    expect(await run("qbo-unlink-customer")).toMatchObject({ success: false });
    expect(qboCalls(seen)).toHaveLength(0);
  });

  it("runs the search through the shared handler", async () => {
    const seen = api(() => jsonResponse(200, { data: { customers: [{ id: "58", displayName: "Amy Co" }] } }));
    const result = await run("qbo-search-customers", { q: "amy" });
    expect(seen[0]).toMatchObject({ method: "GET", path: `${QBO}/customers` });
    expect(result).toMatchObject({ success: true, search: { ok: true } });
  });
});
