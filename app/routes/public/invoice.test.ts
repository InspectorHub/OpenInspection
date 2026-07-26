import { describe, it, expect, afterEach, vi } from "vitest";
import { loader } from "~/routes/public/invoice";
import { createLoadContext } from "~/lib/load-context";

/**
 * IA-34 / IA-44 — the standalone `/invoice/:id` page.
 *
 * IA-34: `GET /api/public/inspections/:id/invoice` is now gated by
 * resolveClientActor, so this loader MUST forward the `?token=` the emailed pay
 * link carries; without it the endpoint 401s and the page shows the
 * link-invalid state rather than a bare "not found".
 *
 * IA-44: once Stripe redirects back with `?redirect_status=succeeded`, the page
 * hands off to the Hub instead of reloading itself, so the three payment
 * entrances converge on one place. Asserted on the loader's own redirect
 * Response.
 */

const API_URL = "https://mock-api.test";

function makeContext() {
  return createLoadContext({ API_URL });
}

function fakeResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

const INVOICE = {
  id: "inv-12345678",
  amountCents: 5000,
  currency: "USD",
  status: "sent",
  createdAt: "2026-06-01T00:00:00.000Z",
  dueDate: null,
  clientName: "Jane",
  lineItems: [{ description: "Inspection", amountCents: 5000 }],
  brand: { companyName: "Acme", primaryColor: null, logoUrl: null, defaultTimezone: "UTC" },
  tenantSlug: "acme",
};

function stubApi(status = 200, data: unknown = INVOICE) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input as string, init);
    calls.push(req.url);
    return fakeResponse(status, status === 200 ? { data } : { error: { code: "UNAUTHORIZED" } });
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

async function runLoader(url: string) {
  try {
    const result = await loader({
      params: { id: "insp1" },
      request: new Request(url),
      context: makeContext(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return { thrown: null as unknown, result };
  } catch (err) {
    return { thrown: err, result: null };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invoice loader — token forwarding (IA-34)", () => {
  it("forwards the link's ?token= to the gated invoice endpoint", async () => {
    const calls = stubApi();
    await runLoader("https://app.test/invoice/insp1?token=tok-abc");
    expect(calls.some((u) => u.includes("token=tok-abc"))).toBe(true);
  });

  it("surfaces the link-invalid state (not a bare 'not found') when the endpoint refuses", async () => {
    stubApi(401);
    const { result } = await runLoader("https://app.test/invoice/insp1");
    const r = result as { invoice: unknown; error: string | null };
    expect(r.invoice).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

describe("invoice loader — post-payment hand-off to the Hub (IA-44)", () => {
  it("302s to the Hub payment section carrying the token and the optimistic marker", async () => {
    stubApi();
    const { thrown } = await runLoader(
      "https://app.test/invoice/insp1?token=tok-abc&redirect_status=succeeded",
    );
    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe(
      "/portal/acme/i/insp1?section=payment&token=tok-abc&redirect_status=succeeded",
    );
  });

  it("does NOT redirect on a normal visit", async () => {
    stubApi();
    const { thrown } = await runLoader("https://app.test/invoice/insp1?token=tok-abc");
    expect(thrown).toBeNull();
  });

  it("does NOT redirect when the tenant slug is unknown (nothing to hand off to)", async () => {
    stubApi(200, { ...INVOICE, tenantSlug: null });
    const { thrown } = await runLoader(
      "https://app.test/invoice/insp1?token=tok-abc&redirect_status=succeeded",
    );
    expect(thrown).toBeNull();
  });
});
