import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantAiConfigs, tenantAiAttestations } from '../db/schema';

/**
 * A workspace's AI settings and its key attestation, read together.
 *
 * ## Why this is its own module now
 *
 * It used to be a widened projection inside `loadTenantEmailConfig`, and the
 * comment there gave the reason: the AI credential was already being loaded by
 * that function, the `tenant_configs` row was already being fetched, and
 * widening a projection costs nothing.
 *
 * Both halves of that reason are gone. The AI fields moved to their own tables
 * when `tenant_configs` hit D1's 100-column ceiling, so this is no longer the
 * same row — and once it is a separate read, nothing about it belongs to the
 * email service. What is left there is a coupling with no argument behind it.
 *
 * ## The invariant that the single read used to carry
 *
 * ⚠️ The old projection fetched the key and the confirmation ABOUT that key in
 * one statement, deliberately, so the two described the same moment. Separate
 * reads cannot promise that on their own, and pretending otherwise would be
 * worse than saying so — so the promise lives on the WRITE side instead: the
 * secrets save writes `secrets_enc` and the attestation row in a single
 * `db.batch()`, D1's only atomic primitive. There is no instant at which one is
 * stored and the other is not, so no reader can observe them disagreeing,
 * however many statements it takes to fetch them.
 *
 * Both reads fail soft, independently and in opposite directions, which is the
 * point of not merging them: an unreadable attestation leaves the AI gate
 * CLOSED, because "could not read" and "never confirmed" must produce the same
 * refusal; an unreadable config falls back to the defaults, because a missing
 * row means a workspace that has switched nothing off. Neither can take email
 * sending down with it.
 */
export interface LoadedTenantAi {
    /** Non-null exactly when an attested key is on file. */
    attestation: typeof tenantAiAttestations.$inferSelect | null;
    aiEnabled: boolean;
    aiBaseUrl: string | null;
    aiModel: string | null;
}

/**
 * Both rows, concurrently. Returns two promises rather than awaiting them, so
 * the caller can fold them into a `Promise.all` it is already running and pay
 * no extra round-trip depth.
 */
export function readTenantAi(db: D1Database, tenantId: string): {
    attestation: Promise<typeof tenantAiAttestations.$inferSelect | null>;
    config: Promise<{ aiEnabled: boolean; aiBaseUrl: string | null; aiModel: string | null } | null>;
} {
    const drz = drizzle(db);
    const attestation = (async () => {
        try {
            const row = await drz
                .select()
                .from(tenantAiAttestations)
                .where(eq(tenantAiAttestations.tenantId, tenantId))
                .get();
            return row ?? null;
        } catch {
            return null;
        }
    })();
    const config = (async () => {
        try {
            const row = await drz
                .select({
                    aiEnabled: tenantAiConfigs.isEnabled,
                    aiBaseUrl: tenantAiConfigs.baseUrl,
                    aiModel: tenantAiConfigs.model,
                })
                .from(tenantAiConfigs)
                .where(eq(tenantAiConfigs.tenantId, tenantId))
                .get();
            return row ?? null;
        } catch {
            return null;
        }
    })();
    return { attestation, config };
}
