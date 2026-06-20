import { drizzle } from 'drizzle-orm/d1';
import { agreementRequests, agreementSigners } from '../../lib/db/schema';
import { hashToken } from '../../lib/token-hash';

/** SHA-256 hex — reused for both token hashing and content-snapshot hashing. */
export const sha256Hex = hashToken;

export interface SignerInput {
    name: string;
    email: string;
    role?: 'client' | 'co_client' | 'agent' | 'other';
    contactId?: string | null;
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
    if (any('viewed') || any('signed')) return 'viewed';
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
        protected db: D1Database,
        protected secrets?: { jwtSecret: string; jwtSecretPrevious?: string },
    ) {}

    protected getDrizzle() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
    }
}
