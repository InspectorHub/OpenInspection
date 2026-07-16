import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatTime } from "./format";

describe("shared formatter", () => {
  it("formats a civil date in the given locale + tz", () => {
    // Civil date (no time) is anchored at UTC midnight; long month.
    expect(formatDate("2026-07-17", { locale: "en-US", timeZone: "UTC", month: "long" }))
      .toBe("July 17, 2026");
    expect(formatDate("2026-07-17", { locale: "es-419", timeZone: "UTC", month: "long" }))
      .toContain("julio");
  });

  it("formats an ISO instant as date-time in the viewer tz", () => {
    // 2026-07-17T20:00Z is 2026-07-18 04:00 in Asia/Shanghai.
    const out = formatDateTime("2026-07-17T20:00:00.000Z", { locale: "en-US", timeZone: "Asia/Shanghai" });
    expect(out).toContain("2026");
    expect(out).toMatch(/4:00|04:00/);
  });

  it("returns empty string for missing/invalid date input", () => {
    expect(formatDate(null, { locale: "en-US" })).toBe("");
    expect(formatDate("nope", { locale: "en-US" })).toBe("");
  });

  it("formats a time in the given tz, optionally with a zone label", () => {
    expect(formatTime("2026-07-17T09:00:00.000Z", { locale: "en-US", timeZone: "UTC" }))
      .toMatch(/9:00\s?AM/);
    expect(formatTime("2026-07-17T09:00:00.000Z", { locale: "en-US", timeZone: "UTC", timeZoneName: "short" }))
      .toContain("UTC");
    expect(formatTime(null, { locale: "en-US" })).toBe("");
  });

  it("formats numbers per locale", () => {
    expect(formatNumber(1234567.89, { locale: "en-US" })).toBe("1,234,567.89");
    expect(formatNumber(1234567.89, { locale: "es-ES" })).toBe("1.234.567,89");
  });

  it("formats currency from integer cents with a symbol", () => {
    expect(formatCurrency(123450, { locale: "en-US", currency: "USD" })).toBe("$1,234.50");
    // narrowSymbol keeps the $ symbol even in Spanish (not the 'USD' code).
    expect(formatCurrency(123450, { locale: "es-419", currency: "USD" })).toContain("$");
  });
});
