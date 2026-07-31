/**
 * The /metrics window arithmetic. Every case here is a civil-calendar edge that
 * a naive `new Date()` + `setMonth()` gets wrong: month-end clamping, a DST
 * boundary inside the span, a zone whose "today" is not the machine's, and a
 * hand-edited query string.
 */
import { describe, it, expect } from "vitest";
import {
  civilToday,
  formatRange,
  matchPreset,
  normaliseRange,
  presetRange,
  PRESET_IDS,
} from "./metrics-range";

describe("presetRange", () => {
  it("counts trailing days inclusively — 7 days means today plus six", () => {
    expect(presetRange("7d", "2026-07-29")).toEqual({ from: "2026-07-23", to: "2026-07-29" });
    expect(presetRange("14d", "2026-07-29")).toEqual({ from: "2026-07-16", to: "2026-07-29" });
    expect(presetRange("30d", "2026-07-29")).toEqual({ from: "2026-06-30", to: "2026-07-29" });
  });

  it("walks months back by calendar month, not by 30 days", () => {
    expect(presetRange("3m", "2026-07-29")).toEqual({ from: "2026-04-29", to: "2026-07-29" });
    expect(presetRange("12m", "2026-07-29")).toEqual({ from: "2025-07-29", to: "2026-07-29" });
  });

  it("clamps to the last day of a month that is too short", () => {
    // Three months back from May 31 is "Feb 31". Date.UTC rolls that into March,
    // which would make "last 3 months" start AFTER "last 2 months" would.
    expect(presetRange("3m", "2026-05-31")).toEqual({ from: "2026-02-28", to: "2026-05-31" });
    expect(presetRange("3m", "2024-05-31")).toEqual({ from: "2024-02-29", to: "2024-05-31" }); // leap
    expect(presetRange("6m", "2026-08-31")).toEqual({ from: "2026-02-28", to: "2026-08-31" });
  });

  it("does not drift across a DST transition", () => {
    // US DST ends 2026-11-01. A span computed in local time picks up an extra
    // hour here and can land a day early; UTC-noon anchoring cannot.
    expect(presetRange("7d", "2026-11-03")).toEqual({ from: "2026-10-28", to: "2026-11-03" });
    expect(presetRange("30d", "2026-11-15")).toEqual({ from: "2026-10-17", to: "2026-11-15" });
  });

  it("starts year-to-date on January 1 of the current year", () => {
    expect(presetRange("ytd", "2026-07-29")).toEqual({ from: "2026-01-01", to: "2026-07-29" });
    expect(presetRange("ytd", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });

  it("always ends today — a metrics page must include the day you are reading it", () => {
    for (const id of PRESET_IDS) expect(presetRange(id, "2026-07-29").to).toBe("2026-07-29");
  });
});

describe("matchPreset", () => {
  it("recognises a preset window so a reload keeps the label", () => {
    expect(matchPreset({ from: "2026-04-29", to: "2026-07-29" }, "2026-07-29")).toBe("3m");
    expect(matchPreset({ from: "2026-01-01", to: "2026-07-29" }, "2026-07-29")).toBe("ytd");
  });

  it("returns null for a window nobody could have picked from the presets", () => {
    expect(matchPreset({ from: "2026-03-14", to: "2026-05-02" }, "2026-07-29")).toBeNull();
  });
});

describe("civilToday", () => {
  it("answers in the given zone, not the machine's", () => {
    // 22:30 UTC on the 29th is already the 30th in Tokyo and still the 29th in
    // New York. A metrics page that used the machine clock would show a
    // different "last 7 days" to two people looking at the same workspace.
    const evening = new Date("2026-07-29T22:30:00Z");
    expect(civilToday("Asia/Tokyo", evening)).toBe("2026-07-30");
    expect(civilToday("America/New_York", evening)).toBe("2026-07-29");
    expect(civilToday("UTC", evening)).toBe("2026-07-29");
  });

  it("falls back to the UTC calendar for an unusable zone", () => {
    expect(civilToday("Not/AZone", new Date("2026-07-29T10:00:00Z"))).toBe("2026-07-29");
    expect(civilToday("", new Date("2026-07-29T10:00:00Z"))).toBe("2026-07-29");
  });
});

describe("normaliseRange", () => {
  const today = "2026-07-29";

  it("defaults to the last three months when the URL names nothing", () => {
    expect(normaliseRange(null, null, today)).toEqual({ from: "2026-04-29", to: today });
  });

  it("passes a well-formed range through untouched", () => {
    expect(normaliseRange("2026-03-01", "2026-03-31", today)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("swaps a reversed range rather than returning an empty window", () => {
    expect(normaliseRange("2026-06-01", "2026-01-01", today)).toEqual({ from: "2026-01-01", to: "2026-06-01" });
  });

  it("resolves garbage instead of erroring — a hand-edited URL must still render", () => {
    expect(normaliseRange("not-a-date", "also-not", today)).toEqual({ from: "2026-04-29", to: today });
    // 2026 is not a leap year, so Feb 30 does not exist and must not roll into March.
    expect(normaliseRange("2026-02-30", null, today)).toEqual({ from: "2026-04-29", to: today });
  });

  it("treats a single supplied end as open and clamps the other to today", () => {
    expect(normaliseRange("2026-05-01", null, today)).toEqual({ from: "2026-05-01", to: today });
    expect(normaliseRange(null, "2026-05-01", today)).toEqual({ from: "2026-04-29", to: "2026-05-01" });
  });

  it("trims an unbounded span — the endpoint scans every envelope in the window", () => {
    const out = normaliseRange("1990-01-01", "2026-07-29", today);
    expect(out.to).toBe("2026-07-29");
    // Trimmed from the `from` end to roughly five years, not from 1990.
    expect(out.from > "2021-01-01" && out.from < "2022-01-01").toBe(true);
  });
});

describe("formatRange", () => {
  it("prints the year once when both ends share it", () => {
    expect(formatRange({ from: "2026-04-29", to: "2026-07-29" }, "en-US")).toBe("Apr 29 – Jul 29, 2026");
  });

  it("prints both years when the window crosses one", () => {
    expect(formatRange({ from: "2025-07-29", to: "2026-07-29" }, "en-US")).toBe("Jul 29, 2025 – Jul 29, 2026");
  });
});
