import { describe, it, expect, afterEach, vi } from "vitest";
import { loadInvoiceSection } from "~/lib/section-loaders";
import { createLoadContext } from "~/lib/load-context";

/**
 * IA-34 — the Hub's `?section=payment` slot used to read
 * `GET /api/public/inspections/:id/invoice` with no credential at all ("the pay
 * flow is keyed by inspection id — no token"). That endpoint is now gated by
 * resolveClientActor, so this loader must present BOTH credentials the gate
 * accepts: the Hub's per-inspection portal token AND the forwarded
 * portal-session cookie (the typed client never forwards the browser cookie by
 * itself).
 */

const API_URL = "https://mock-api.test";

function stub() {
  const seen: Array<{ url: string; cookie: string | null }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input as string, init);
    seen.push({ url: req.url, cookie: req.headers.get("cookie") });
    const text = JSON.stringify({ data: null });
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => JSON.parse(text),
      text: async () => text,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadInvoiceSection — Hub payment section credentials (IA-34)", () => {
  it("sends the per-inspection token as ?token=", async () => {
    const seen = stub();
    await loadInvoiceSection(createLoadContext({ API_URL }), "insp1", "hub-tok", "");
    expect(seen[0].url).toContain("token=hub-tok");
  });

  // The cookie fallback (for a magic-link session whose best-effort
  // per-inspection token failed to issue) cannot be asserted from this
  // environment: `Cookie` is a forbidden header name, and happy-dom's Request
  // constructor drops it — the same harness limitation documented in
  // app/routes/public/portal-inspection.test.ts for Set-Cookie. What IS pinned
  // here is that a token-less call still goes out (rather than being skipped)
  // and never invents an empty `?token=`, which would fail the gate outright.
  it("still issues the call with no ?token= when only a session cookie is available", async () => {
    const seen = stub();
    await loadInvoiceSection(
      createLoadContext({ API_URL }),
      "insp1",
      "",
      "__Host-portal_session=abc",
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/inspections/insp1/invoice");
    expect(seen[0].url).not.toContain("token=");
  });
});
