import { describe, it, expect } from "vitest";
import { isEmailTestStepId, persistedOutcomes } from "./email-test-steps";

describe("persistedOutcomes", () => {
  const row = (over: Record<string, unknown>) => ({
    target: "email", step: "key_valid", ok: true, detail: null, testedAt: 1, ...over,
  }) as Parameters<typeof persistedOutcomes>[0][number];

  it("keeps the newest result per step", () => {
    const out = persistedOutcomes([
      row({ step: "key_valid", ok: false, detail: "old", testedAt: 1 }),
      row({ step: "key_valid", ok: true, detail: "new", testedAt: 2 }),
    ]);
    expect(out.key_valid).toEqual({ status: "pass", detail: "new" });
  });

  it("ignores single-shot rows, other targets and unknown steps", () => {
    const out = persistedOutcomes([
      row({ step: null }),
      row({ target: "stripe", step: "key_valid" }),
      row({ step: "not_a_step" }),
    ]);
    expect(out).toEqual({});
  });

  it("maps a failed row to fail", () => {
    expect(persistedOutcomes([row({ ok: false, detail: "bad" })]).key_valid).toEqual({ status: "fail", detail: "bad" });
  });
});

describe("isEmailTestStepId", () => {
  it("accepts a known id and rejects everything else", () => {
    expect(isEmailTestStepId("send_test")).toBe(true);
    expect(isEmailTestStepId("send_test ")).toBe(false);
    expect(isEmailTestStepId(null)).toBe(false);
  });
});
