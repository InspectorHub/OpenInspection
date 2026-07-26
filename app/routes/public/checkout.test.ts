import { describe, it, expect, afterEach, vi } from "vitest";
import { loader } from "~/routes/public/checkout";
import { createLoadContext } from "~/lib/load-context";

/**
 * IA-44 — `/checkout` used to end on a completion card whose "View your report"
 * link was `/report/:tenant/:id` with NO token, while the visitor held only an
 * agreement SIGNER token. Now the checkout endpoint hands back the signer's own
 * PORTAL token and a settled checkout 302s into the Hub carrying it.
 *
 * These assert the loader's own HTTP response (redirect status + Location), not
 * a rendered page: a client-side bounce would prove nothing about the server.
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

interface CheckoutOverrides {
  signerStatus?: string;
  progress?: { signed: number; total: number };
  paymentRequired?: boolean;
  paymentPaid?: boolean;
  invoiceStatus?: "paid" | "partial" | "unpaid" | null;
  portalToken?: string | null;
}

function stubCheckout(over: CheckoutOverrides = {}) {
  const data = {
    signer: { name: "Jane", role: "client", status: over.signerStatus ?? "signed" },
    agreement: { name: "Standard", content: "<p>terms</p>", contentHash: "abc" },
    envelope: {
      status: "signed",
      completionPolicy: "all",
      progress: over.progress ?? { signed: 1, total: 1 },
    },
    invoice:
      over.invoiceStatus === null
        ? null
        : { id: "inv1", amountCents: 5000, currency: "USD", status: over.invoiceStatus ?? "paid" },
    payment: { required: over.paymentRequired ?? true, paid: over.paymentPaid ?? true },
    inspection: { id: "insp1", propertyAddress: "1 Main St" },
    branding: { companyName: "Acme", primaryColor: null },
    portalToken: over.portalToken === undefined ? "portal-tok-1" : over.portalToken,
  };
  const mock = vi.fn(async () => fakeResponse(200, { data }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function runLoader(url = "https://app.test/checkout/acme/signer-tok") {
  try {
    const result = await loader({
      params: { tenant: "acme", token: "signer-tok" },
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

describe("checkout loader — completed checkout hands off to the Hub (IA-44)", () => {
  it("302s to the Hub report section carrying the portal token", async () => {
    stubCheckout();
    const { thrown } = await runLoader();
    expect(thrown).toBeInstanceOf(Response);
    const res = thrown as Response;
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe(
      "/portal/acme/i/insp1?section=report&token=portal-tok-1",
    );
  });

  it("does NOT redirect while the agreement is still outstanding", async () => {
    stubCheckout({ signerStatus: "sent", progress: { signed: 0, total: 1 } });
    const { thrown, result } = await runLoader();
    expect(thrown).toBeNull();
    expect((result as { checkout: unknown }).checkout).toBeTruthy();
  });

  it("does NOT redirect while payment is still outstanding (server truth, not the ?redirect_status hint)", async () => {
    stubCheckout({ paymentPaid: false, invoiceStatus: "unpaid" });
    const { thrown } = await runLoader(
      "https://app.test/checkout/acme/signer-tok?redirect_status=succeeded",
    );
    expect(thrown).toBeNull();
  });

  it("does NOT redirect when no portal token was minted (e.g. an agent signer) — no token, no hand-off", async () => {
    stubCheckout({ portalToken: null });
    const { thrown, result } = await runLoader();
    expect(thrown).toBeNull();
    expect((result as { portalToken: string | null }).portalToken).toBeNull();
  });

  it("exposes the portal token to the page so the pay-intent call can authenticate", async () => {
    stubCheckout({ signerStatus: "sent", progress: { signed: 0, total: 1 } });
    const { result } = await runLoader();
    expect((result as { portalToken: string | null }).portalToken).toBe("portal-tok-1");
  });
});
