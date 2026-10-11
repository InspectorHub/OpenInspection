import type { createApi } from "~/lib/api-client.server";
import { isEmailTestStepId, isStripeTestStepId } from "~/lib/test-steps";
import { m } from "~/paraglide/messages";

type Api = ReturnType<typeof createApi>;
type Body = { data?: { status: "pass" | "fail" | "skipped" | "pending"; detail?: string | null } } | null;

/**
 * Runs one step of a stepwise connection test for a settings action. A step that
 * ran but failed is still `ok` (the outcome says how it went); `outcome: null`
 * means the request itself failed (unknown step, rate limit, transport).
 */
function shape(intent: string, step: string | null, data: NonNullable<NonNullable<Body>['data']> | undefined) {
  return {
    intent,
    ok: Boolean(data),
    error: data ? null : m.settings_teststeps_error(),
    step,
    outcome: data ? { status: data.status, detail: data.detail ?? null } : null,
  };
}

export async function runEmailTestStepIntent(api: Api, intent: string, rawStep: unknown) {
  if (!isEmailTestStepId(rawStep)) return shape(intent, null, undefined);
  const res = await api.integrationsTestSteps.email.$post({ json: { step: rawStep } });
  const body = res.ok ? ((await res.json().catch(() => null)) as Body) : null;
  return shape(intent, rawStep, body?.data);
}

export async function runStripeTestStepIntent(api: Api, intent: string, rawStep: unknown) {
  if (!isStripeTestStepId(rawStep)) return shape(intent, null, undefined);
  const res = await api.integrationsTestSteps.stripe.$post({ json: { step: rawStep } });
  const body = res.ok ? ((await res.json().catch(() => null)) as Body) : null;
  return shape(intent, rawStep, body?.data);
}
