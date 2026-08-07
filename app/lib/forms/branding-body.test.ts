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

  it("splits repair quick phrases one per line, keeping the tenant's order", () => {
    // Order is the whole reason this is a textarea: line order is button order.
    const body = brandingUpdateBody(
      values({ companyName: "Acme", repairQuickPhrasesPresent: "1", repairQuickPhrases: "Replacement requested\n\n  Repair requested  \n" }),
    );
    expect(body.repairQuickPhrases).toEqual(["Replacement requested", "Repair requested"]);
  });

  it("sends [] when the panel was on the page and the tenant emptied it", () => {
    // The off switch. If this arrived as an omitted key instead, clearing the
    // list would silently do nothing and the defaults would look intentional.
    const body = brandingUpdateBody(values({ companyName: "Acme", repairQuickPhrasesPresent: "1", repairQuickPhrases: "" }));
    expect(Object.hasOwn(body, "repairQuickPhrases")).toBe(true);
    expect(body.repairQuickPhrases).toEqual([]);
  });

  it("omits repairQuickPhrases entirely when the panel was not on the page", () => {
    // The other half: a save from a form without the editor must never clear a
    // configured list. Assert the ABSENCE OF THE KEY, not the resulting value —
    // a `[]` here reads as "the tenant turned the buttons off".
    const body = brandingUpdateBody(values({ companyName: "Acme" }));
    expect(Object.hasOwn(body, "repairQuickPhrases")).toBe(false);
  });
});
