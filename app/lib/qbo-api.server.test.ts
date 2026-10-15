import { describe, it, expect, afterEach, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";
import { qboApiFetch, qboCaller } from "./qbo-api.server";

/**
 * Every caller of this helper treats `null` as "the request could not be made".
 * A failed network call has to arrive as `null`, not as a rejected promise that
 * escapes the helper's own try/catch.
 */

const CALLER = qboCaller(new Request("https://app.test/x", { headers: { Cookie: "a=b" } }), "jwt");
const context = () => createLoadContext({ API_URL: "https://mock-api.test" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("qboApiFetch", () => {
  it("answers null when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));

    await expect(qboApiFetch(context(), CALLER, "/status")).resolves.toBeNull();
  });

  it("answers the response when the request succeeds (control for the case above)", async () => {
    const ok = { status: 200, ok: true } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => ok));

    await expect(qboApiFetch(context(), CALLER, "/status")).resolves.toBe(ok);
  });

  it("sends the session token as a Bearer credential next to the cookie", async () => {
    const seen: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (r: Request) => { seen.push(r); return { status: 200 } as Response; }));

    await qboApiFetch(context(), CALLER, "/status");

    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer jwt");
    expect(seen[0]!.headers.get("Cookie")).toBe("a=b");
  });
});
