// @vitest-environment happy-dom
/**
 * The hosted legal page's "Last updated" line.
 *
 * It replaced a hardcoded literal in the message catalogue — one date, shown on
 * EVERY tenant's page whatever their document said, and stale from the release
 * that shipped it. The replacement's only real hazard is the one every civil-date
 * bug in this codebase has come from.
 */
import { describe, it, expect } from "vitest";
import { formatLegalVersion } from "./legal";

describe("formatLegalVersion", () => {
  it("renders a civil date the way a reader writes one", () => {
    expect(formatLegalVersion("2026-08-01")).toBe("August 1, 2026");
    expect(formatLegalVersion("2026-01-01")).toBe("January 1, 2026");
    expect(formatLegalVersion("2026-12-31")).toBe("December 31, 2026");
  });

  it("does not go through Date, so it cannot land on the previous day", () => {
    // The input is ALREADY the tenant's civil date, computed in their timezone.
    // `new Date("2026-08-01")` parses as UTC midnight, and reading local parts
    // back off it renders July 31 for every reader west of Greenwich — which is
    // exactly the class of bug `lint:tz` exists to catch. Asserting the boundary
    // dates is what makes this spec fail if someone "simplifies" it to
    // toLocaleDateString.
    expect(formatLegalVersion("2026-03-01")).toBe("March 1, 2026");
    expect(formatLegalVersion("2026-01-31")).toBe("January 31, 2026");
  });

  it("says nothing when nothing has been published", () => {
    // Null means the tenant has never published. The page then omits the line
    // rather than inventing a date.
    expect(formatLegalVersion(null)).toBeNull();
  });

  it("passes an unrecognised value through instead of guessing at it", () => {
    expect(formatLegalVersion("not-a-date")).toBe("not-a-date");
    expect(formatLegalVersion("2026-13-01")).toBe("2026-13-01");
  });
});
