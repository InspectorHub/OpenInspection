import { drizzle } from 'drizzle-orm/d1';
import type { agreementRequests, agreementSigners } from '../../lib/db/schema';

export interface SignerInput {
    name: string;
    email: string;
    role?: 'client' | 'co_client' | 'agent' | 'other';
    contactId?: string | null;
}

/** What a sign request carries besides the drawing. */
export interface SignedOpts {
    signedAtMs: number; channel: 'remote' | 'in_person'; ipAddress?: string | null; userAgent?: string | null;
    onBehalfOf?: string | null; onBehalfDisclaimer?: string | null;
    /**
     * Which language-disclosure version this signer was SHOWN, or null
     * when the platform did not draw the screen and so cannot say.
     * REQUIRED and never defaulted here: only the caller knows what
     * reached a screen, and an optional field would let a future sign
     * surface record silence that reads like a pre-feature signature.
     */
    languageDisclosureVersion: number | null;
}

export interface ResolvedSigner {
    signer: typeof agreementSigners.$inferSelect;
    envelope: typeof agreementRequests.$inferSelect;
}

/**
 * Track I-a — derive the envelope (agreement_requests.status) as a STORED
 * aggregate of its signer statuses under the completion policy.
 *   - 'all' : every signer must sign for the envelope to be 'signed'; any
 *             decline drags the whole envelope to 'declined'.
 *   - 'one' : a single signature completes the envelope; the envelope only
 *             declines when EVERY signer has declined.
 */
export function computeEnvelopeStatus(
    policy: 'all' | 'one',
    signers: Array<{ status: string }>,
): 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' {
    if (signers.length === 0) return 'pending';
    const all = (s: string) => signers.every((x) => x.status === s);
    const any = (s: string) => signers.some((x) => x.status === s);
    if (all('declined')) return 'declined';
    if (policy === 'one' && any('signed')) return 'signed';
    if (policy === 'all') {
        if (any('declined')) return 'declined';
        if (all('signed')) return 'signed';
    }
    if (any('viewed') || any('signing') || any('signed')) return 'viewed';
    if (any('sent')) return 'sent';
    return 'pending';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Shared base for the AgreementService composition. Holds the constructor
 * injection (D1 + optional secrets) and the per-call drizzle factory. The
 * tier mixins (template / legacy envelope / signer-state) extend this so the
 * composed `AgreementService` has one identical public surface.
 */
export class AgreementServiceBase {
    constructor(
        public db: D1Database,
        public secrets?: { jwtSecret: string; jwtSecretPrevious?: string },
    ) {}

    public getDrizzle() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
    }
}
