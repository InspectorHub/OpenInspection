import { describe, it, expect } from "vitest";
import { matchesWorkflow } from "~/routes/dashboard";

/**
 * #111 — the standalone /reports page is retired and its report-oriented list
 * moves into the dashboard's "Published" workflow tab. These tests pin the
 * widened Published filter and the matching narrowing of the Active tab
 * (report-ready statuses are no longer fieldwork).
 */

// matchesWorkflow only reads `status` (and paymentStatus for awaiting_payment);
// build a minimal inspection for each status under test.
function insp(status: string, paymentStatus?: string) {
  return {
    id: "i1",
    date: null,
    address: null,
    clientName: null,
    status,
    paymentStatus,
  };
}

describe("matchesWorkflow — published tab (report view absorption)", () => {
  it.each(["completed", "delivered", "published", "signed"])(
    "matches report-ready status %s",
    (status) => {
      expect(matchesWorkflow(insp(status), "published")).toBe(true);
    },
  );

  it.each(["draft", "scheduled", "in_progress", "cancelled"])(
    "does not match non-report status %s",
    (status) => {
      expect(matchesWorkflow(insp(status), "published")).toBe(false);
    },
  );
});

describe("matchesWorkflow — active tab (fieldwork only)", () => {
  it.each(["scheduled", "in_progress", "confirmed", "draft"])(
    "matches fieldwork status %s",
    (status) => {
      expect(matchesWorkflow(insp(status), "active")).toBe(true);
    },
  );

  it("no longer matches completed (report-ready is not fieldwork)", () => {
    expect(matchesWorkflow(insp("completed"), "active")).toBe(false);
  });
});

describe("matchesWorkflow — unchanged tab semantics", () => {
  it("drafts tab matches draft", () => {
    expect(matchesWorkflow(insp("draft"), "drafts")).toBe(true);
  });

  it("awaiting_payment matches delivered+unpaid", () => {
    expect(matchesWorkflow(insp("delivered", "unpaid"), "awaiting_payment")).toBe(true);
    expect(matchesWorkflow(insp("delivered", "paid"), "awaiting_payment")).toBe(false);
  });

  it("cancelled tab matches cancelled", () => {
    expect(matchesWorkflow(insp("cancelled"), "cancelled")).toBe(true);
  });

  it("all tab matches anything", () => {
    expect(matchesWorkflow(insp("draft"), "all")).toBe(true);
  });
});
