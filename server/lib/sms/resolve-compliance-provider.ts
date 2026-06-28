// server/lib/sms/resolve-compliance-provider.ts
//
// Build the ComplianceProvider for a managed-ISV provider id. This is the single
// construction seam the coordinator (MessagingComplianceService) and the managed
// admin routes call to obtain a provider bound to the platform's managed-ISV
// credentials. Twilio-only this plan; Telnyx is added in Plan 2.
//
// The managed-ISV credential env names are the SAME triple the send path reads in
// resolve-twilio.ts (buildManagedBag): TWILIO_ACCOUNT_SID (master Account SID),
// TWILIO_API_KEY_SID (API Key SID), TWILIO_API_KEY_SECRET (API Key Secret). When
// any is absent we throw 'managed_not_configured' so standalone / unconfigured
// SaaS fail closed (the route surfaces this as HTTP 409).

import type { ComplianceProvider, ComplianceProviderId } from '../messaging/compliance-provider';
import { TwilioComplianceProvider, type TwilioComplianceClient } from '../messaging/providers/twilio-compliance';
import { TelnyxComplianceProvider, type TelnyxComplianceClient } from '../messaging/providers/telnyx-compliance';
import { createFetchHttpClient } from '../messaging/twilio-http-client';
import twilio from 'twilio';
import Telnyx from 'telnyx';

/** Platform env slice carrying the managed-ISV credentials. Props accept explicit
 *  `undefined` (callers spread straight from a Worker env where each is optional). */
export interface ComplianceResolverEnv {
    /** Managed-ISV master Account SID. */
    TWILIO_ACCOUNT_SID?: string | undefined;
    /** Managed-ISV API Key SID (not the Account SID). */
    TWILIO_API_KEY_SID?: string | undefined;
    /** Managed-ISV API Key Secret. */
    TWILIO_API_KEY_SECRET?: string | undefined;
    /** Managed-ISV Telnyx API key (Plan 2). Drives the 10DLC / TFV provision path. */
    TELNYX_API_KEY?: string | undefined;
}

/**
 * Resolve a ComplianceProvider for the given provider id, bound to the platform's
 * managed-ISV credentials. Throws 'managed_not_configured' when the credentials are
 * absent (fail-closed) or the provider id is not configured this plan.
 */
export function resolveComplianceProvider(
    env: ComplianceResolverEnv,
    providerId: ComplianceProviderId,
): ComplianceProvider {
    if (providerId === 'twilio') {
        const accountSid = env.TWILIO_ACCOUNT_SID;
        const apiKeySid = env.TWILIO_API_KEY_SID;
        const apiKeySecret = env.TWILIO_API_KEY_SECRET;
        if (!accountSid || !apiKeySid || !apiKeySecret) throw new Error('managed_not_configured');
        // API-key auth: username = API Key SID, password = API Key Secret, account = master SID.
        // The edge-safe fetch transport (Task 3) replaces twilio-node's default axios/node-http.
        const client = twilio(apiKeySid, apiKeySecret, {
            accountSid,
            httpClient: createFetchHttpClient() as never,
        });
        return new TwilioComplianceProvider(client as unknown as TwilioComplianceClient);
    }
    if (providerId === 'telnyx') {
        const apiKey = env.TELNYX_API_KEY;
        if (!apiKey) throw new Error('managed_not_configured');
        // The telnyx SDK is edge-native (Stainless): it routes through the global
        // `fetch` with Bearer auth, so no custom httpClient is needed (unlike twilio-node).
        const client = new Telnyx({ apiKey });
        return new TelnyxComplianceProvider(client as unknown as TelnyxComplianceClient);
    }
    // Unknown provider id — fail closed.
    throw new Error('managed_not_configured');
}
