/**
 * Client-safe description of the stepwise email connection test: the ordered
 * step ids and the shape of one step's outcome. The server owns the logic
 * (`server/lib/integration/email-test-steps.ts`); this file only names things.
 */
export const EMAIL_TEST_STEPS = [
  "key_valid",
  "key_scope",
  "sender_domain_verified",
  "send_test",
  "quota",
  "delivery",
] as const;

export type EmailTestStepId = (typeof EMAIL_TEST_STEPS)[number];

export type StepStatus = "pass" | "fail" | "skipped" | "pending";

export interface StepOutcome {
  status: StepStatus;
  detail: string | null;
}

export function isEmailTestStepId(v: unknown): v is EmailTestStepId {
  return typeof v === "string" && (EMAIL_TEST_STEPS as readonly string[]).includes(v);
}

/**
 * Outcomes the server already stored (pass/fail only; skipped and pending are
 * never recorded), newest first per step, so the checklist survives a reload.
 */
export function persistedOutcomes(
  rows: ReadonlyArray<{ target: string; step: string | null; ok: boolean; detail: string | null; testedAt: number }>,
): Partial<Record<EmailTestStepId, StepOutcome>> {
  const out: Partial<Record<EmailTestStepId, StepOutcome>> = {};
  const newestFirst = [...rows].sort((a, b) => b.testedAt - a.testedAt);
  for (const r of newestFirst) {
    if (r.target !== "email" || !isEmailTestStepId(r.step) || out[r.step]) continue;
    out[r.step] = { status: r.ok ? "pass" : "fail", detail: r.detail };
  }
  return out;
}
