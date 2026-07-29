/**
 * IA-92 — the editor header's date used `toLocaleDateString(undefined, …)`,
 * i.e. the RUNTIME's default locale. That is en-US on the Workers server and
 * whatever the visitor set in their browser on the client, so the same date
 * rendered as two different strings and React threw #418 on every editor load
 * outside en-US. (The German case below stands in for that: a locale whose
 * date format genuinely differs from the server's.)
 *
 * The guard against a regression is mostly structural — `locale` is a REQUIRED
 * option now, so it cannot be omitted back into a runtime default. This pins
 * the other half: that the value passed in is actually the one used, rather
 * than being accepted and then ignored.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInspectionState } from "./useInspection";

const base = {
  inspection: { id: "i1", date: "2026-05-29T09:00:00.000Z" },
  schema: { sections: [] },
  results: {},
};

describe("useInspectionState — formattedDate is locale-pinned (IA-92)", () => {
  it("formats with the locale it was given, not the runtime default", () => {
    const { result } = renderHook(() => useInspectionState({ ...base, locale: "en-US" }));
    expect(result.current.formattedDate).toBe("May 29, 2026");
  });

  it("produces a DIFFERENT string for a different locale — proving the input is honoured", () => {
    const en = renderHook(() => useInspectionState({ ...base, locale: "en-US" }));
    const de = renderHook(() => useInspectionState({ ...base, locale: "de-DE" }));

    expect(de.result.current.formattedDate).not.toBe(en.result.current.formattedDate);
    // If `locale` were ignored (the old bug), both would collapse to whatever
    // the test runner's default happens to be, and this would fail.
  });

  it("returns an empty string rather than throwing when the inspection has no date", () => {
    const { result } = renderHook(() =>
      useInspectionState({ ...base, inspection: { id: "i1" }, locale: "en-US" }),
    );
    expect(result.current.formattedDate).toBe("");
  });
});
