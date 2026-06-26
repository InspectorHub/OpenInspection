/**
 * Provider resolution — maps a stored `sms_byo_provider` value to the matching
 * MessagingProvider adapter instance. The resolver is a pure selection function:
 * it does NOT do I/O; callers supply the already-decrypted creds.
 *
 * Currently supports:
 *   - 'twilio'  (default/null) → TwilioClient
 *   - 'telnyx'                 → TelnyxProvider
 */
import type { MessagingProvider } from './provider';
import { TwilioClient } from './twilio';
import { TelnyxProvider } from './telnyx';

export interface TwilioResolvedCreds { sid: string; token: string; from: string; }
export interface TelnyxResolvedCreds { apiKey: string; from: string; }
export type ProviderCreds = TwilioResolvedCreds | TelnyxResolvedCreds;

/**
 * Return a MessagingProvider for the given `byoProvider` value + their creds.
 * `null | undefined | 'twilio'`  → TwilioClient (existing behavior, unchanged).
 * `'telnyx'`                     → TelnyxProvider.
 */
export function resolveProvider(
    byoProvider: 'twilio' | 'telnyx' | null | undefined,
    creds: ProviderCreds,
): MessagingProvider {
    if (byoProvider === 'telnyx') {
        const c = creds as TelnyxResolvedCreds;
        return new TelnyxProvider({ apiKey: c.apiKey, from: c.from });
    }
    // Default: Twilio (for null, undefined, or explicit 'twilio')
    const c = creds as TwilioResolvedCreds;
    return new TwilioClient({ sid: c.sid, token: c.token });
}
