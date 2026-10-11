import { StepChecklist } from "~/components/settings/StepChecklist";
import type { ConnectionTestResult } from "~/lib/connection-test";
import { EMAIL_TEST_STEPS } from "~/lib/test-steps";
import { m } from "~/paraglide/messages";

const LABEL: Record<(typeof EMAIL_TEST_STEPS)[number], () => string> = {
  key_valid: () => m.settings_emailsteps_key_valid(),
  key_scope: () => m.settings_emailsteps_key_scope(),
  sender_domain_verified: () => m.settings_emailsteps_sender_domain_verified(),
  send_test: () => m.settings_emailsteps_send_test(),
  quota: () => m.settings_emailsteps_quota(),
  delivery: () => m.settings_emailsteps_delivery(),
};

/** Resend "Test connection": six steps; the test email always goes to the signed-in user. */
export function EmailStepTest({ results }: { results: ConnectionTestResult[] }) {
  return (
    <StepChecklist
      target="email"
      intent="test-email-step"
      steps={EMAIL_TEST_STEPS}
      label={(s) => LABEL[s as keyof typeof LABEL]()}
      results={results}
      notice={m.settings_emailsteps_notice()}
      recheckStep="delivery"
    />
  );
}
