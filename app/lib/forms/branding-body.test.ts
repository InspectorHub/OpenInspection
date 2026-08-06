// @vitest-environment node
import { describe, it, expect } from "vitest";
import { brandingUpdateBody } from "~/lib/forms/branding-body";

/** The action always hands over a successfully-parsed submission value. */
const values = (v: Record<string, unknown>) => v as Parameters<typeof brandingUpdateBody>[0];

describe("brandingUpdateBody", () => {
  it("sends every checkbox explicitly, even when the box was never rendered", () => {
    const body = brandingUpdateBody(values({ companyName: "Acme" }));
    expect(body).toMatchObject({
      enableRepairList: false,
      enableCustomerRepairExport: false,
      pdfShowFooter: false,
      pdfShowPageNumbers: false,
      pdfShowLicense: false,
    });
  });

  it("keeps a checked box true", () => {
    const body = brandingUpdateBody(values({ companyName: "Acme", enableRepairList: true, pdfShowLicense: true }));
    expect(body.enableRepairList).toBe(true);
    expect(body.pdfShowLicense).toBe(true);
  });

  it("omits preference keys that arrived empty so a stored choice survives", () => {
    const body = brandingUpdateBody(
      values({ companyName: "Acme", defaultTimezone: "", defaultLocale: "", currency: "", dateFormat: "", timeFormat: "" }),
    );
    for (const key of ["defaultTimezone", "defaultLocale", "currency", "dateFormat", "timeFormat"]) {
      expect(Object.hasOwn(body, key)).toBe(false);
    }
  });

  it("sends preference keys that carry a value", () => {
    const body = brandingUpdateBody(
      values({ companyName: "Acme", defaultTimezone: "America/Denver", defaultLocale: "es-MX", currency: "MXN", dateFormat: "iso", timeFormat: "24h" }),
    );
    expect(body).toMatchObject({
      defaultTimezone: "America/Denver",
      defaultLocale: "es-MX",
      currency: "MXN",
      dateFormat: "iso",
      timeFormat: "24h",
    });
  });

  it("trims companyAddress and lets an empty string clear it", () => {
    expect(brandingUpdateBody(values({ companyName: "Acme", companyAddress: "  1 Main St  " })).companyAddress).toBe("1 Main St");
    const cleared = brandingUpdateBody(values({ companyName: "Acme", companyAddress: "" }));
    expect(Object.hasOwn(cleared, "companyAddress")).toBe(true);
    expect(cleared.companyAddress).toBe("");
  });

  it("splits custom referral sources one per line, dropping blanks", () => {
    const body = brandingUpdateBody(values({ companyName: "Acme", customReferralSources: "Zillow\n\n  Redfin  \n" }));
    expect(body.customReferralSources).toEqual(["Zillow", "Redfin"]);
  });

  it("omits customReferralSources entirely when the field was absent", () => {
    expect(Object.hasOwn(brandingUpdateBody(values({ companyName: "Acme" })), "customReferralSources")).toBe(false);
  });
});
