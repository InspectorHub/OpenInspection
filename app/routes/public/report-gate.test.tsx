import { describe, it, expect } from "vitest";
import { loader } from "./report-gate";
import type { Route } from "./+types/report-gate";

// IA-45 — the orphaned /report-gate page is retired to a 301 that lands the
// client on the Hub overview, where the lock reason + CTA now live inline.

describe("report-gate route retirement (IA-45)", () => {
  it("301-redirects to the Hub overview for the same inspection", async () => {
    const res = await loader({
      params: { tenant: "t1", id: "insp1" },
    } as unknown as Route.LoaderArgs);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/portal/t1/i/insp1?section=overview");
  });
});
