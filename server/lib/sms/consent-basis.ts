/**
 * TCPA / D5 consent basis per contact-role KIND (Communication A3.2).
 *
 * Track L D5: only consumers need a recorded consent event; business
 * counterparties and staff are implied. The Communication design (2026-07-28
 * §3.5) widened that from "client key vs agent/inspector" to the role KIND
 * axis — every `kind: 'client'` profile is a consumer (including co_client and
 * any tenant-invented client role), and `other` is the bucket for Attorney /
 * Transaction Coordinator / Insurance Agent / Title Company.
 *
 * `sms_consent_log.recipient_type` mirrors these values so a future capture
 * path can stamp non-client rows honestly. Today only consumer capture paths
 * write the ledger (booking form / opt-in link / admin attest); agent/other
 * remain implied and are not recorded. Staff must not be written here as
 * consumer consent. Do not unify agent/staff onto the client express UI
 * solely for carrier filings — describe the layered program in TFV/campaign
 * answers instead (see docs/sms-compliance.md).
 */
import type { RoleKind } from '../people/role-kinds';

export type ConsentRecipientType = 'client' | 'agent' | 'other';
export type ConsentBasis = 'express' | 'implied';

export const CONSENT_BASIS_BY_KIND: Record<RoleKind, {
    recipientType: ConsentRecipientType;
    basis: ConsentBasis;
    /** Why this kind sits on this side of the express/implied line. */
    rationale: string;
}> = {
    client: {
        recipientType: 'client',
        basis: 'express',
        rationale: 'TCPA consumer — recorded granted event required before any SMS',
    },
    agent: {
        recipientType: 'agent',
        basis: 'implied',
        rationale: 'D5 B2B — phone-on-file with a known agent partner is implied consent',
    },
    other: {
        recipientType: 'other',
        basis: 'implied',
        rationale:
            'D5 business counterparties (Attorney, Transaction Coordinator, Insurance Agent, Title Company) — implied; say so explicitly rather than letting absence of a rule decide',
    },
};

/** True when this kind must have a latest `granted` row before SMS may send. */
export function requiresExpressSmsConsent(kind: RoleKind): boolean {
    return CONSENT_BASIS_BY_KIND[kind].basis === 'express';
}
