/**
 * The AI provenance sink, built once per request and injected into AIService.
 *
 * Shaped exactly like `metering.ts` and for the same reason: there is ONE
 * chokepoint (`AIService.callGemini`) and everything that must happen on every
 * AI call is wired there, as an injected seam rather than as a call the service
 * makes for itself. A second write site somewhere else would be a second answer
 * to "what ran", and two records of one call eventually disagree.
 *
 * WHERE THE FACTS COME FROM, AND WHY THEY ARE SPLIT THE WAY THEY ARE.
 *   - tenant / mode / model are REQUEST-scoped and arrive here already
 *     resolved, from the same single credential read in `di.ts` that tags the
 *     meter and answers the capability gate. Re-resolving them here would
 *     create a third opinion about whose key a call runs on, and the whole
 *     point of the injected picture is that there is only one.
 *   - capability / promptVersion / provider are CALL-scoped and come from the
 *     chokepoint: the workload it is running, the version token of the prompt
 *     it rendered, and the id of the adapter instance it is about to call. The
 *     provider id is read off the adapter rather than off configuration so the
 *     row names the backend that actually ran.
 *
 * WHAT IS NOT HERE: the prompt. Not truncated, not hashed, not "just the first
 * line". See the schema comment on `ai_call_provenance` — the entry type below
 * has no field that could carry it, which is the enforcement.
 *
 * WHAT A ROW PROVES, AND WHAT IT DOES NOT. Everything written here except
 * `configVersion` is OBSERVED at the chokepoint: the workload that ran, the
 * prompt version that was rendered, the id of the adapter instance about to be
 * called. So a row is evidence that a call was made and which backend it was
 * made to. It is NOT evidence that the workspace's stored ATTESTATION about
 * that backend was accurate — an attestation is a statement someone made, and
 * the two are joined by `configVersion` so they can be compared rather than
 * confused.
 */
import { drizzle } from 'drizzle-orm/d1';
import { aiCallProvenance } from '../db/schema';
import type { AiUsageKind } from '../usage/period';
import type { AiCredentialSource } from './resolve-provider';

/** The per-call facts. Deliberately closed: there is no `prompt` field, and
 *  adding one is a compliance decision (schema comment on the table). */
interface AiProvenanceEntry {
    capability: AiUsageKind;
    /** `AI_PROMPTS[…].version` — the whole reason those tokens are stable. */
    promptVersion: string;
    /** `AiProvider.id` of the adapter that is about to be called. */
    provider: string;
    /**
     * `tenant_configs.ai_config_version` in force for this call, or null.
     *
     * The ONE field here that is not observed. `provider` is read off the
     * adapter instance precisely so the row names the backend that actually
     * ran; this is a value the caller supplies, and it may be, because it
     * describes CONFIGURATION rather than what happened — which is exactly
     * what it claims to describe.
     *
     * Null is a real answer, not a missing one: the managed path's destination
     * belongs to the deployment and does not move per workspace, so there is
     * no per-workspace version to cite. Writing 0 instead would assert that
     * version 0 was in force.
     */
    configVersion?: number | null;
}

export interface AiProvenanceSink {
    /**
     * Writes the row and returns its `ai_call_provenance.id`.
     *
     * It used to return `Promise<void>` and mint the id inline, which made the
     * ledger unciteable: a row existed for every call and no caller could name
     * which row was theirs, so review evidence had nothing to point at. The id
     * is returned rather than accepted as an argument so there is still exactly
     * one place it is minted.
     *
     * REJECTS RATHER THAN RETURNING AN ID FOR A ROW THAT DOES NOT EXIST — the
     * insert is awaited before the return. A caller that holds an id is holding
     * a fact, and the chokepoint refuses the send when this throws.
     */
    record(entry: AiProvenanceEntry): Promise<string>;
}

/**
 * Build the sink for one request, or `undefined` when there is no tenant to
 * attribute a call to.
 *
 * `undefined` is not "skip the record": `tenant_id` is NOT NULL and a row that
 * belongs to no workspace could not be scoped, exported or explained, so the
 * chokepoint treats a missing sink as a refusal to run the call at all. Every
 * AI route is role-gated and therefore always has a tenant; the undefined arm
 * exists so that stops being true LOUDLY if a public path ever reaches the
 * service.
 */
export function buildAiProvenanceSink(args: {
    db: D1Database;
    tenantId: string | null;
    /** Resolved credential source — the meter's tag and the gate's source. */
    source: AiCredentialSource;
    /** Model id in force for this deployment (`AI_MODEL`). */
    model: string;
}): AiProvenanceSink | undefined {
    const { db, tenantId, source, model } = args;
    if (!tenantId) return undefined;

    return {
        record: async (entry) => {
            const id = crypto.randomUUID();
            await drizzle(db).insert(aiCallProvenance).values({
                id,
                tenantId,
                capability: entry.capability,
                provider: entry.provider,
                mode: source,
                model,
                promptVersion: entry.promptVersion,
                configVersion: entry.configVersion ?? null,
                createdAt: new Date(),
            });
            return id;
        },
    };
}
