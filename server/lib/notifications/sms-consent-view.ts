/**
 * The SMS consent block as the notification screen of a portal reader receives it (server/lib/response-projection.ts).
 *
 * The block also names the contact rows the consent was read across; the screen reads none of that, so it is not carried.
 */
import type { SmsConsentBlock } from './channel-consent';
import { projectFields } from '../response-projection';

const SMS_CONSENT_FIELDS = ['phone', 'state', 'at', 'capturedVia', 'mode', 'disclosure'] as const;

export function projectSmsConsent(block: SmsConsentBlock | null) {
    return block === null ? null : projectFields(block, SMS_CONSENT_FIELDS);
}

/** The field list, for the spec that holds it to the screen type. */
export const SMS_CONSENT_VIEW_FIELDS = SMS_CONSENT_FIELDS;
