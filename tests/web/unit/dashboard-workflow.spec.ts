import { describe, it, expect } from "vitest";
import { matchesWorkflow } from "~/routes/dashboard";

/**
 * Status-split update: the Published tab now matches on reportStatus=published,
 * and the Active tab matches inspection statuses requested/scheduled/confirmed.
 * Old statuses (draft/delivered/in_progress/signed) no longer exist in the
 * canonical model; these tests reflect the new semantics.
 */

// matchesWorkflow reads status (and reportStatus + paymentStatus for some tabs).
function insp(status: string, paymentStatus?: string, reportStatus = 'in_progress') {
  return {
    id: "i1",
    date: null,
    address: null,
    clientName: null,
    status,
    reportStatus,
    paymentStatus,
  };
}

describe("matchesWorkflow — published tab (reportStatus axis)", () => {
  it("matches published reportStatus", () => {
    expect(matchesWorkflow(insp("completed", undefined, "published"), "published")).toBe(true);
  });

  it.each(["in_progress", "submitted"])(
    "does not match non-published reportStatus %s",
    (reportStatus) => {
      expect(matchesWorkflow(insp("completed", undefined, reportStatus), "published")).toBe(false);
    },
  );

  it("does not match cancelled status (reportStatus published)", () => {
    // reportStatus=published but inspection cancelled — still matches (report shipped)
    expect(matchesWorkflow(insp("cancelled", undefined, "published"), "published")).toBe(true);
  });
});

describe("matchesWorkflow — active tab (requested/scheduled/confirmed)", () => {
  it.each(["requested", "scheduled", "confirmed"])(
    "matches active inspection status %s",
    (status) => {
      expect(matchesWorkflow(insp(status), "active")).toBe(true);
    },
  );

  it("does not match completed", () => {
    expect(matchesWorkflow(insp("completed"), "active")).toBe(false);
  });

  it("does not match cancelled", () => {
    expect(matchesWorkflow(insp("cancelled"), "active")).toBe(false);
  });
});

describe("matchesWorkflow — unchanged tab semantics", () => {
  it("requested tab matches requested", () => {
    expect(matchesWorkflow(insp("requested"), "requested")).toBe(true);
  });

  it("awaiting_payment matches published reportStatus + unpaid", () => {
    expect(matchesWorkflow(insp("completed", "unpaid", "published"), "awaiting_payment")).toBe(true);
    expect(matchesWorkflow(insp("completed", "paid", "published"), "awaiting_payment")).toBe(false);
  });

  it("to_review matches submitted reportStatus", () => {
    expect(matchesWorkflow(insp("completed", undefined, "submitted"), "to_review")).toBe(true);
    expect(matchesWorkflow(insp("completed", undefined, "in_progress"), "to_review")).toBe(false);
  });

  it("cancelled tab matches cancelled", () => {
    expect(matchesWorkflow(insp("cancelled"), "cancelled")).toBe(true);
  });

  it("all tab matches anything", () => {
    expect(matchesWorkflow(insp("requested"), "all")).toBe(true);
  });
});
