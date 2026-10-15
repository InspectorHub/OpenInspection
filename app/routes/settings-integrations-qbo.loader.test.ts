import { describe, it, expect, afterEach, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";

/**
 * The page the OAuth callback redirects back to must be able to read the
 * connection status on that very first request.
 *
 * Intuit sends the browser back through a cross-site redirect chain, and the
 * API's session cookie is `SameSite=Strict`, so the browser withholds it on the
 * landing request. The page's own `__session` cookie (Lax) does arrive, and the
 * loader already unwraps the JWT from it, so the status call has to carry that
 * JWT as a Bearer credential. Forwarding only `Cookie` made the status call
 * answer 401 straight after connecting, and the page showed "not connected"
 * until the visitor refreshed.
 */

vi.mock("~/lib/session.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/session.server")>()),
  requireToken: async () => "jwt-from-session",
}));

import { loader, action } from "./settings-integrations-qbo";

const API_URL = "https://mock-api.test";

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

/** Records every outbound request and answers 200 `{ data: {} }` to all of them. */
function recordFetch() {
  const seen: Request[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string) => {
    if (typeof input !== "string") seen.push(input);
    return jsonResponse(200, { data: {} });
  }));
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuickBooks settings route — credential on the status read", () => {
  it("sends the session JWT as a Bearer credential when no Strict cookie arrives", async () => {
    const seen = recordFetch();
    const request = new Request("https://app.test/settings/integrations/qbo?connected=1", {
      headers: { Cookie: "__session=opaque-session-cookie" },
    });

    await loader({ request, context: createLoadContext({ API_URL }), params: {} } as never);

    const statusCalls = seen.filter((r) => new URL(r.url).pathname === "/api/integrations/qbo/status");
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0].headers.get("Authorization")).toBe("Bearer jwt-from-session");
  });

  it("still forwards the Cookie header alongside it", async () => {
    const seen = recordFetch();
    const request = new Request("https://app.test/settings/integrations/qbo", {
      headers: { Cookie: "__session=opaque-session-cookie" },
    });

    await loader({ request, context: createLoadContext({ API_URL }), params: {} } as never);

    const status = seen.find((r) => new URL(r.url).pathname === "/api/integrations/qbo/status");
    expect(status?.headers.get("Cookie")).toBe("__session=opaque-session-cookie");
  });

  it("carries the same credential on a sync issued from the page", async () => {
    const seen = recordFetch();
    const form = new FormData();
    form.set("intent", "qbo-sync");
    const request = new Request("https://app.test/settings/integrations/qbo", {
      method: "POST",
      headers: { Cookie: "__session=opaque-session-cookie" },
      body: form,
    });

    await action({ request, context: createLoadContext({ API_URL }), params: {} } as never);

    const sync = seen.find((r) => new URL(r.url).pathname === "/api/integrations/qbo/sync");
    expect(sync?.headers.get("Authorization")).toBe("Bearer jwt-from-session");
  });
});
