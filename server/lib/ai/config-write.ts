import type { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantAiConfigs } from '../db/schema';

// Matches `server/lib/integration-test-results.ts` — the D1 handle this file's
// only caller already holds, not a second database abstraction.
type Db = ReturnType<typeof drizzle>;

export interface AiConfigInput {
    /**
     * Whether this workspace may be offered AI at all.
     *
     * A PROVISIONING answer, not a permission: whether a given call is allowed
     * is decided in `resolveAi`, where a provider is actually built. The two are
     * separate because this value is also read by a console in another
     * deployment, and a value that meant "permitted" would let an edit there
     * grant a capability here with no deploy.
     */
    aiEnabled: boolean;
    /** The OpenAI-compatible endpoint. Blank means unset. */
    aiBaseUrl: string;
    /**
     * #23 — whether this workspace may PRODUCE a courtesy translation.
     *
     * ⚠️ Production only. Reader paths answer from stored rows and never
     * consult it, so switching it off stops new translations being made and can
     * never strip one from a report already delivered. Defaults FALSE, unlike
     * `aiEnabled` above: that one means "nothing switched off", this one is a
     * decision to spend on every publish, and off is the absence of a choice.
     */
    courtesyTranslationEnabled: boolean;
    /** The model id to send. Blank means unset. */
    aiModel: string;
}

/** Blank means UNSET, and unset is null. `resolveAi` branches on null; a stored
 *  empty string would be a configured endpoint that resolves to nothing and
 *  then refuses for the wrong reason. */
function orNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/**
 * Store a workspace's AI provider configuration.
 *
 * The version bump is the reason this is a function rather than an inline
 * update. Anything holding a resolved endpoint needs a way to know it is
 * holding a stale one, and a counter nobody increments answers that question
 * with a number that never moves.
 *
 * Turning AI off does NOT clear the endpoint or the model — the switch's own
 * helper text promises as much, and a save path that cleared them on the way to
 * storing `false` would make that copy a lie.
 */
export async function saveAiConfig(db: Db, tenantId: string, input: AiConfigInput): Promise<void> {
    const settings = {
        isEnabled: input.aiEnabled,
        baseUrl: orNull(input.aiBaseUrl),
        model: orNull(input.aiModel),
        // #23 — the courtesy-translation switch rides the same save,
        // because it is the same page and the same decision to make.
        isCourtesyTranslationEnabled: input.courtesyTranslationEnabled,
        updatedAt: new Date(),
    };
    // An UPSERT, where the previous version of this was a plain UPDATE.
    // `tenant_configs` always had a row by the time anyone reached the settings
    // page — half a dozen unrelated writers create it — so an update that
    // matched nothing was not a case that could arise. A table of its own has
    // no such incidental creator: the FIRST save is the row's first existence,
    // and an UPDATE here would silently store nothing.
    await db
        .insert(tenantAiConfigs)
        .values({ tenantId, ...settings })
        .onConflictDoUpdate({
            target: tenantAiConfigs.tenantId,
            set: { ...settings },
        });
}

/**
 * Read it back. Never returns a credential — the key lives in encrypted secrets
 * and is surfaced by its own field, so this endpoint has nothing to leak.
 *
 * No row reads the same as an unconfigured one — and since these fields moved
 * to a table of their own, NO ROW IS THE ORDINARY CASE. It used to be the rare
 * one: `tenant_configs` had a row for every workspace long before anyone opened
 * this page, so the fallbacks below were a formality. Here the row appears on
 * first save and not before, so every workspace that has never configured AI
 * takes this path, and these defaults are what it sees.
 *
 * They are kept identical to the column defaults on purpose. Repeating a
 * DIFFERENT one would make the value a workspace sees depend on which of two
 * places answered — and now that the no-row path is the common one, the two
 * would disagree for almost everybody rather than almost nobody.
 */
export async function readAiConfig(db: Db, tenantId: string): Promise<AiConfigInput> {
    const row = await db
        .select({
            aiEnabled: tenantAiConfigs.isEnabled,
            aiBaseUrl: tenantAiConfigs.baseUrl,
            aiModel: tenantAiConfigs.model,
            courtesyTranslationEnabled: tenantAiConfigs.isCourtesyTranslationEnabled,
        })
        .from(tenantAiConfigs)
        .where(eq(tenantAiConfigs.tenantId, tenantId))
        .get();
    return {
        aiEnabled: row?.aiEnabled ?? true,
        aiBaseUrl: row?.aiBaseUrl ?? '',
        aiModel: row?.aiModel ?? '',
        // FALSE with no row, matching the column default. A workspace that has
        // never opened this page has not opted into per-publish spend.
        courtesyTranslationEnabled: row?.courtesyTranslationEnabled ?? false,
    };
}

/**
 * Which key a connection probe should use.
 *
 * A workspace that saved a key and came back to test it submits an empty box —
 * `SecretField` sends nothing it was never given — so a probe that refused on
 * blank would be unusable for the configuration most likely to need testing:
 * the one already in use.
 *
 * The fallback is to the WORKSPACE's stored key and to nothing else. The
 * endpoint this replaced probed a deployment environment variable, which is
 * exactly how it could report success for a configuration that no tenant call
 * had ever used.
 */
export function keyForProbe(
    submitted: string,
    stored: string | null,
): { key: string } | { refuse: 'apiKey' } {
    const typed = submitted.trim();
    if (typed !== '') return { key: typed };
    const fallback = (stored ?? '').trim();
    if (fallback !== '') return { key: fallback };
    return { refuse: 'apiKey' };
}
