import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec section 2 — the invoice "from" party names the registered legal entity.
 *
 * The page reads it off the resolved tenant brand, so this asserts the seam
 * that carries it: `resolveTenantBrand` must pass `legalName` through from the
 * public brand payload, and must NOT re-apply the legalName → companyName
 * fallback (that lives in BrandingService.getBrand and nowhere else).
 */
const brandGet = vi.fn();

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({ publicReport: { brand: { ":tenant": { $get: brandGet } } } })),
}));

vi.mock("~/lib/load-context", () => ({
  getCloudflareEnv: () => ({ APP_NAME: "OpenInspection" }),
}));

import { resolveTenantBrand } from "~/lib/tenant-brand.server";

function payload(data: Record<string, unknown>) {
  return { ok: true, json: async () => ({ data }) } as unknown as Response;
}

describe("resolveTenantBrand — legalName", () => {
  beforeEach(() => brandGet.mockReset());

  it("carries the resolved legal entity through to the page", async () => {
    brandGet.mockResolvedValue(payload({
      companyName: "Acme Home Inspections",
      legalName: "Acme Holdings LLC",
    }));
    const brand = await resolveTenantBrand({} as never, "acme");
    expect(brand.legalName).toBe("Acme Holdings LLC");
    expect(brand.companyName).toBe("Acme Home Inspections");
  });

  // A payload with no legalName is a deployment that predates the column, not a
  // licence to guess one. '' renders nothing rather than naming the brand as
  // the legal entity.
  it("is an empty string when the payload carries none", async () => {
    brandGet.mockResolvedValue(payload({ companyName: "Acme Home Inspections" }));
    expect((await resolveTenantBrand({} as never, "acme")).legalName).toBe("");
  });

  it("is an empty string when the brand lookup fails", async () => {
    brandGet.mockResolvedValue({ ok: false } as unknown as Response);
    expect((await resolveTenantBrand({} as never, "acme")).legalName).toBe("");
  });
});
