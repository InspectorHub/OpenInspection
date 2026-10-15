/**
 * Which message explains a source reason to a person.
 *
 * The UI never invents text for an unavailable source: it asks this function
 * for a message key and renders `m[key]` with the parameters named in
 * `SOURCE_REASON_PARAMS`. A reason that needs no explanation (the source simply
 * resolved) maps to null.
 *
 * Every key exists in messages/en and messages/es-419, and a test holds the two
 * to the same placeholders and to the product vocabulary (Built-in, Your own).
 */
import type { IntegrationService, IntegrationSource, SourceReason } from './sources';

export type SourceReasonMessageKey =
    | 'integrations_source_reason_not_offered'
    | 'integrations_source_reason_provided_not_configured'
    | 'integrations_source_reason_own_credentials_incomplete'
    | 'integrations_source_reason_provider_confirmation_pending';

const KEYS: Record<SourceReason, SourceReasonMessageKey | null> = {
    explicit_choice: null,
    legacy_setting: null,
    profile_default: null,
    not_offered: 'integrations_source_reason_not_offered',
    provided_not_configured: 'integrations_source_reason_provided_not_configured',
    own_credentials_incomplete: 'integrations_source_reason_own_credentials_incomplete',
    provider_confirmation_pending: 'integrations_source_reason_provider_confirmation_pending',
};

/** The message key for a row, or null when the source works and nothing needs saying. */
export function sourceReasonMessageKey(row: {
    service: IntegrationService;
    source: IntegrationSource;
    reason: SourceReason;
}): SourceReasonMessageKey | null {
    // A source that resolved has nothing to explain, whatever the reason says.
    if (row.source !== 'unavailable') return null;
    return KEYS[row.reason];
}
