import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedDateTimeFormat, cachedNumberFormat, cachedRelativeTimeFormat, resetIntlCacheForTests } from "./intl-cache";
import { formatDate, formatDateTime, formatNumber, formatCurrency, formatRelativeTime, formatTime } from "./format";
import { formatInspectionDateTime, formatShapedDate, formatShapedDateTime } from "./format-date";
import { formatBookingDate } from "~/components/booking/booking-date-rules";
import { civilToday, formatRange } from "./metrics-range";
import { dayKeyInZone, dayLabel } from "./communication-view";
import { timeZoneOffsetMinutes } from "./timezones";

const RealDTF = Intl.DateTimeFormat;

/** Count `new Intl.DateTimeFormat(...)` constructions while `fn` runs. */
function countConstructions(fn: () => void): number {
  let count = 0;
  const Counting = new Proxy(RealDTF, {
    construct(target, args, newTarget) {
      count += 1;
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, thisArg, args) {
      count += 1;
      return Reflect.apply(target, thisArg, args);
    },
  });
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Counting;
  try {
    fn();
  } finally {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = RealDTF;
  }
  return count;
}

afterEach(() => {
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = RealDTF;
  resetIntlCacheForTests();
  vi.restoreAllMocks();
});

const LOCALES = ["en-US", "en-GB", "es-419", "de-DE", "ja-JP", "ar-EG"];
const ZONES = ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland", "Australia/Lord_Howe"];
// 2026-03-08T07:00Z is the US spring-forward instant; 2026-11-01T06:00Z is fall-back.
const INSTANTS = [0, Date.UTC(2026, 2, 8, 6, 59), Date.UTC(2026, 2, 8, 7, 0), Date.UTC(2026, 10, 1, 5, 59), Date.UTC(2026, 10, 1, 6, 0), Date.UTC(2026, 11, 31, 23, 59, 59)];

describe("intl cache", () => {
  it("returns the same formatter instance for the same locale and options", () => {
    const a = cachedDateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
    const b = cachedDateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
    expect(a).toBe(b);
    expect(cachedDateTimeFormat("en-GB", { timeZone: "UTC", month: "short" })).not.toBe(a);
    expect(cachedDateTimeFormat("en-US", { timeZone: "UTC", month: "long" })).not.toBe(a);
  });

  it("formats byte-identically to a fresh formatter across locales, zones and DST edges", () => {
    for (const locale of LOCALES) {
      for (const timeZone of ZONES) {
        const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone };
        for (const t of INSTANTS) {
          expect(cachedDateTimeFormat(locale, opts).format(t)).toBe(new RealDTF(locale, opts).format(t));
          expect(cachedDateTimeFormat(locale, opts).formatToParts(t)).toEqual(new RealDTF(locale, opts).formatToParts(t));
        }
      }
    }
  });

  it("keeps throwing for an invalid time zone, and does not cache the failure", () => {
    expect(() => cachedDateTimeFormat("en-US", { timeZone: "Not/AZone" })).toThrow(RangeError);
    expect(() => new RealDTF("en-US", { timeZone: "Not/AZone" })).toThrow(RangeError);
    expect(() => cachedDateTimeFormat("en-US", { timeZone: "Not/AZone" })).toThrow(RangeError);
  });

  it("caches number and relative-time formatters too", () => {
    expect(cachedNumberFormat("de-DE", { style: "currency", currency: "EUR" })).toBe(cachedNumberFormat("de-DE", { currency: "EUR", style: "currency" }));
    expect(cachedNumberFormat("de-DE").format(1234567.891)).toBe(new Intl.NumberFormat("de-DE").format(1234567.891));
    expect(cachedRelativeTimeFormat("es-419", { numeric: "auto", style: "long" }).format(-3, "day")).toBe(new Intl.RelativeTimeFormat("es-419", { numeric: "auto", style: "long" }).format(-3, "day"));
  });

  it("distinguishes an absent locale from an empty one, so a locale that throws is never answered from the cache", () => {
    const fallback = cachedDateTimeFormat(undefined as unknown as string, { timeZone: "UTC" });
    expect(fallback.format(0)).toBeTruthy();
    expect(() => cachedDateTimeFormat("", { timeZone: "UTC" })).toThrow(RangeError);
    expect(() => new RealDTF("", { timeZone: "UTC" })).toThrow(RangeError);
  });

  it("stays bounded", () => {
    for (let i = 0; i < 2000; i++) cachedDateTimeFormat("en-US", { timeZone: "UTC", fractionalSecondDigits: ((i % 3) + 1) as 1 | 2 | 3, hour: "numeric", minute: String(i) === "x" ? "numeric" : "2-digit", second: i % 2 ? "numeric" : "2-digit" });
    // No assertion on size beyond not throwing and still being correct afterwards.
    expect(cachedDateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(0)).toBe("Jan");
  });
});

describe("format helpers construct each formatter once", () => {
  it("formatInspectionDateTime over many rows builds a small constant number of formatters", () => {
    const fmt = { locale: "en-US" };
    const n = countConstructions(() => {
      for (let i = 0; i < 200; i++) formatInspectionDateTime(new Date(Date.UTC(2026, 5, 1 + (i % 28), 14, 30)).toISOString(), new Date(Date.UTC(2026, 6, 1)), "America/New_York", fmt);
    });
    expect(n).toBeLessThanOrEqual(4);
  });

  it("every exported helper is cached", () => {
    const n = countConstructions(() => {
      for (let i = 0; i < 50; i++) {
        formatDate(0, { locale: "en-US", timeZone: "UTC" });
        formatTime(0, { locale: "en-US", timeZone: "UTC", timeZoneName: "short", hourCycle: "h23" });
        formatDateTime(0, { locale: "en-US", timeZone: "UTC" });
        formatShapedDate(0, "UTC", { locale: "es-419", dateFormat: "eu" });
        formatShapedDateTime(0, "UTC", { locale: "es-419", timeFormat: "24h" });
        formatNumber(5, { locale: "en-US" });
        formatCurrency(500, { locale: "en-US", currency: "USD" });
        formatRelativeTime(0, { locale: "en-US", now: 1e9 });
      }
    });
    expect(n).toBeLessThanOrEqual(8);
  });
});

describe("component and view helpers reuse their formatters", () => {
  it("formats many values with a small constant number of constructions, and the same text as before", () => {
    const before = {
      booking: new RealDTF("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(Date.UTC(2026, 9, 18, 12)),
      range: `${new RealDTF("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(Date.UTC(2026, 3, 29, 12))} – ${new RealDTF("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(Date.UTC(2026, 6, 29, 12))}`,
    };
    let booking = "";
    let range = "";
    const n = countConstructions(() => {
      for (let i = 0; i < 50; i++) {
        booking = formatBookingDate("2026-10-18", "en-US");
        range = formatRange({ from: "2026-04-29", to: "2026-07-29" }, "en-US");
        civilToday("America/New_York", new Date(Date.UTC(2026, 9, 18, 3)));
        dayKeyInZone(Date.UTC(2026, 9, 18, 3), "Asia/Tokyo");
        dayLabel("2026-10-01", "2026-10-18", "2026-10-17", "en-US");
        timeZoneOffsetMinutes("America/New_York", new Date(Date.UTC(2026, 9, 18)));
      }
    });
    expect(n).toBeLessThanOrEqual(10);
    expect(booking).toBe(before.booking);
    expect(range).toBe(before.range);
  });
});
