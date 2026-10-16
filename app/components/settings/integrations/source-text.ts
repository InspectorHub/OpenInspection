import { m } from "~/paraglide/messages";
import type { IntegrationSource } from "../../../../server/lib/integrations/sources";
import type { SourceReasonMessageKey } from "../../../../server/lib/integrations/source-reasons";

/**
 * Whose account, in words. An unavailable source says why when there is a
 * reason to give. Shared by the hub cards and the service pages so the same
 * state never reads two ways.
 */
export function sourceText(source: IntegrationSource, reasonKey: SourceReasonMessageKey | null, title: string, dedicated = false): string {
  if (source === "own" && dedicated) return m.integrations_hub_source_dedicated();
  if (source === "provided") return m.integrations_hub_source_provided();
  if (source === "own") return m.integrations_hub_source_own();
  switch (reasonKey) {
    case "integrations_source_reason_not_offered":
      return m.integrations_source_reason_not_offered({ service: title });
    case "integrations_source_reason_provided_not_configured":
      return m.integrations_source_reason_provided_not_configured({ service: title });
    case "integrations_source_reason_dedicated_not_ready":
      return m.integrations_source_reason_dedicated_not_ready();
    case "integrations_source_reason_dedicated_unavailable":
      return m.integrations_source_reason_dedicated_unavailable();
    case "integrations_source_reason_provider_confirmation_pending":
      return m.integrations_source_reason_provider_confirmation_pending();
    // The missing details are named on the service's own page; here the line
    // only says which account it will use once they are added.
    case "integrations_source_reason_own_credentials_incomplete":
      return m.integrations_hub_source_own();
    default:
      return m.integrations_hub_source_unavailable();
  }
}
