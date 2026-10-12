import { describe, it, expect } from "vitest";
import { EMAIL_TEST_STEPS, STRIPE_TEST_STEPS, isEmailTestStepId, isStripeTestStepId, persistedOutcomes } from "./test-steps";

describe("persistedOutcomes", () => {
  const row = (over: Record<string, unknown>) => ({
    target: "email", step: "key_valid", ok: true, detail: null, testedAt: 1, ...over,
  }) as Parameters<typeof persistedOutcomes>[0][number];

  it("keeps the newest result per step", () => {
    const out = persistedOutcomes([
      row({ ok: false, detail: "old", testedAt: 1 }),
      row({ ok: true, detail: "new", testedAt: 2 }),
    ], "email", EMAIL_TEST_STEPS);
    expect(out.key_valid).toEqual({ status: "pass", detail: "new" });
  });

  it("ignores single-shot rows, other targets and unknown steps", () => {
    const out = persistedOutcomes([
      row({ step: null }),
      row({ target: "stripe", step: "key_valid" }),
      row({ step: "not_a_step" }),
    ], "email", EMAIL_TEST_STEPS);
    expect(out).toEqual({});
  });

  it("reads each target's own steps", () => {
    const rows = [row({ target: "stripe", step: "webhook", ok: false, detail: "bad" }), row({ step: "webhook" })];
    expect(persistedOutcomes(rows, "stripe", STRIPE_TEST_STEPS).webhook).toEqual({ status: "fail", detail: "bad" });
    // email has no "webhook" step, so the same rows yield nothing for it
    expect(persistedOutcomes(rows, "email", EMAIL_TEST_STEPS)).toEqual({});
  });
});

describe("step id guards", () => {
  it("accept a known id of their own target and reject everything else", () => {
    expect(isEmailTestStepId("send_test")).toBe(true);
    expect(isEmailTestStepId("webhook")).toBe(false);
    expect(isStripeTestStepId("webhook")).toBe(true);
    expect(isStripeTestStepId("send_test")).toBe(false);
    expect(isEmailTestStepId("send_test ")).toBe(false);
    expect(isEmailTestStepId(null)).toBe(false);
  });
});
