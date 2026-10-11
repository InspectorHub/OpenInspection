import { StepChecklist } from "~/components/settings/StepChecklist";
import type { ConnectionTestResult } from "~/lib/connection-test";
import { STRIPE_TEST_STEPS } from "~/lib/test-steps";
import { m } from "~/paraglide/messages";

const LABEL: Record<(typeof STRIPE_TEST_STEPS)[number], () => string> = {
  key_valid: () => m.settings_stripesteps_key_valid(),
  account_capabilities: () => m.settings_stripesteps_account_capabilities(),
  webhook: () => m.settings_stripesteps_webhook(),
};

/** Stripe "Test connection": three read-only steps; nothing is charged or created. */
export function StripeStepTest({ results }: { results: ConnectionTestResult[] }) {
  return (
    <StepChecklist
      target="stripe"
      intent="test-stripe-step"
      steps={STRIPE_TEST_STEPS}
      label={(s) => LABEL[s as keyof typeof LABEL]()}
      results={results}
    />
  );
}
