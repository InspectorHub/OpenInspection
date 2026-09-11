// @vitest-environment happy-dom
/**
 * THREE QUESTIONS, THREE ANSWERS, ONE OF WHICH MUST NEVER BE UTC-BY-ACCIDENT.
 *
 * `tenant_configs.default_timezone` is NOT NULL DEFAULT 'UTC', so "the workspace
 * has not said" and "the workspace said UTC" are the same stored string. Reading
 * that sentinel as a zone is what had the New Inspection wizard default an
 * inspection to `9:00 AM UTC` while the home checklist, on the same account, was
 * still listing `Set your timezone` as unfinished. Two surfaces, one unset value,
 * opposite conclusions.
 *
 * So the value a NEW time is authored in (`useSchedulingTimeZone`) falls through
 * the sentinel to the browser's own zone — a real IANA id, named on screen beside
 * the field, and right far more often than UTC. The value a BUSINESS RECORD is
 * interpreted in (`useCompanyTimeZone`) deliberately does the opposite: it ignores
 * the per-viewer override entirely, because two members of staff in different
 * zones must file the same afternoon's payment on the same day.
 *
 * `process.env.TZ` is set per case so the browser-zone branch is asserted against
 * a known value rather than whatever zone CI happens to run in — a test that
 * asserted "not UTC" would be vacuous on a UTC runner, which is every runner.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSchedulingTimeZone, useCompanyTimeZone, useDisplayTimeZone } from "~/hooks/useSessionContext";

let loaderData: unknown;

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useRouteLoaderData: () => loaderData };
});

/** Only the two fields these three hooks read; the rest of SessionContext is
 *  irrelevant here and a full fixture would hide which field drove the answer. */
function session(opts: { companyTz?: string; userTz?: string | null }) {
  loaderData = {
    context: {
      branding: { defaultTimezone: opts.companyTz ?? "UTC" },
      user: { timezone: opts.userTz ?? null },
    },
  };
}

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  loaderData = undefined;
});

describe("useSchedulingTimeZone — the zone a new time is authored in", () => {
  it("never resolves to the UTC sentinel; it falls through to the browser zone", () => {
    process.env.TZ = "America/Denver";
    session({ companyTz: "UTC" }); // the never-configured workspace

    const { result } = renderHook(() => useSchedulingTimeZone());

    // THE DISCRIMINATING ASSERTION. `not.toBe("UTC")` alone would pass on a
    // runner whose own zone is UTC — which is most of them — so the expected
    // value is named. With the old `useDisplayTimeZone` behaviour this is "UTC".
    expect(result.current).toBe("America/Denver");
    expect(result.current).not.toBe("UTC");
  });

  it("prefers the declared company zone over the browser", () => {
    process.env.TZ = "America/Denver";
    session({ companyTz: "America/Chicago" });
    expect(renderHook(() => useSchedulingTimeZone()).result.current).toBe("America/Chicago");
  });

  it("prefers the viewer's own override over both", () => {
    process.env.TZ = "America/Denver";
    session({ companyTz: "America/Chicago", userTz: "Europe/Berlin" });
    expect(renderHook(() => useSchedulingTimeZone()).result.current).toBe("Europe/Berlin");
  });

  it("honours Etc/UTC as a deliberate company choice rather than falling through", () => {
    // The positive control for the sentinel rule: a workspace that really is in
    // UTC must be able to say so, and must not be overridden by the browser.
    process.env.TZ = "America/Denver";
    session({ companyTz: "Etc/UTC" });
    expect(renderHook(() => useSchedulingTimeZone()).result.current).toBe("Etc/UTC");
  });

  it("still returns a usable zone with no session context at all", () => {
    process.env.TZ = "America/Denver";
    loaderData = undefined;
    expect(renderHook(() => useSchedulingTimeZone()).result.current).toBe("America/Denver");
  });
});

describe("useCompanyTimeZone — the authority for a business record", () => {
  it("ignores the viewer's override, where useDisplayTimeZone honours it", () => {
    session({ companyTz: "America/Chicago", userTz: "Asia/Tokyo" });

    // Both numbers side by side: the same session, the two hooks, the two
    // different answers they are each supposed to give. A company-zone hook that
    // quietly delegated to the display one would make these equal.
    expect(renderHook(() => useCompanyTimeZone()).result.current).toBe("America/Chicago");
    expect(renderHook(() => useDisplayTimeZone()).result.current).toBe("Asia/Tokyo");
  });

  it("does NOT fall through to the browser — a shared wrong zone beats a per-viewer one", () => {
    // Unlike the scheduling hook. The bug being fixed is staff disagreeing with
    // each other about a ledger date; substituting each viewer's own zone here
    // would reintroduce exactly that.
    process.env.TZ = "America/Denver";
    session({ companyTz: "UTC" });
    expect(renderHook(() => useCompanyTimeZone()).result.current).toBe("UTC");
  });
});
