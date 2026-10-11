import type { createApi } from "~/lib/api-client.server";
import { isEmailTestStepId } from "~/lib/email-test-steps";
import { m } from "~/paraglide/messages";

/**
 * Runs one step of the stepwise email test for the settings action. A step that
 * ran but failed is still `ok` (the outcome says how it went); `outcome: null`
 * means the request itself failed (unknown step, rate limit, transport).
 */
export async function runEmailTestStepIntent(api: ReturnType<typeof createApi>, intent: string, rawStep: unknown) {
  if (!isEmailTestStepId(rawStep)) {
    return { intent, ok: false, error: m.settings_emailsteps_error(), step: null, outcome: null };
  }
  const res = await api.integrationsTestSteps.email.$post({ json: { step: rawStep } });
  const body = res.ok ? await res.json().catch(() => null) : null;
  const data = body && "data" in body ? body.data : null;
  return {
    intent,
    ok: Boolean(data),
    error: data ? null : m.settings_emailsteps_error(),
    step: rawStep,
    outcome: data ? { status: data.status, detail: data.detail ?? null } : null,
  };
}
