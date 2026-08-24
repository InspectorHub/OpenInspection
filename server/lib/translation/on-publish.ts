/**
 * The publish-time hook for a courtesy translation.
 *
 * Kept out of both publish modules on purpose. `server/api/inspections/publish.ts`
 * and `server/services/inspection/inspection-publish.service.ts` are each at
 * their large-file cap, and — more usefully — publishing is about whether a
 * document is finished, while this is about whether a second copy of it gets
 * produced. Two questions, two files.
 *
 * ## Per-report opt-in, default OFF
 *
 * Nothing here decides to translate. Production costs money and the decision
 * stays with whoever incurs it, so a translation is produced only when the
 * publisher asked for one on this publish. A workspace-level switch gates
 * whether the request may be honoured at all; it never makes the request.
 *
 * ⚠️ THE SWITCH GATES PRODUCTION, NEVER CONSUMPTION. Turning the feature off
 * must not alter a single already-published report. That invariant lives on the
 * READER side — reader paths answer from stored rows and never consult a tenant
 * setting — and the only thing this module may do with the switch is decline to
 * make a new row.
 *
 * ## Failure is not a failed publish
 *
 * A translation that could not be produced leaves the English report published
 * and correct, which is the state the whole feature degrades to by design. So
 * this never throws into the publish path: it reports what happened and the
 * caller records it.
 */
import type { Context } from 'hono';
import { generateCourtesyTranslation, type GenerateCourtesyTranslationDeps } from './generate';
import { isCourtesyTranslationEnabled } from './production-switch';
import { logger } from '../logger';
import type { HonoConfig } from '../../types/hono';

export interface OnPublishTranslationInput {
    tenantId: string;
    inspectionId: string;
    /** Which deliverable was published. Absent = the primary report. */
    reportId?: string;
    /**
     * The locale the publisher asked for on THIS publish, or null for no.
     * Null is the default and the absence of a choice, not a choice of "no".
     */
    requestedLocale: string | null;
    /** `tenant_configs` — whether this workspace may produce translations at all. */
    productionEnabled: boolean;
}

export type OnPublishTranslationOutcome =
    /** No locale was asked for. The overwhelmingly common case. */
    | { status: 'not_requested' }
    /** Asked for, but the workspace has production switched off. */
    | { status: 'production_disabled' }
    | { status: 'produced'; reportId: string; locale: string; segmentCount: number }
    /** Asked for, attempted, and it did not happen. The report is still published. */
    | { status: 'failed'; locale: string; reason: string };

export async function translateOnPublish(
    deps: GenerateCourtesyTranslationDeps,
    input: OnPublishTranslationInput,
): Promise<OnPublishTranslationOutcome> {
    if (!input.requestedLocale) return { status: 'not_requested' };
    if (!input.productionEnabled) return { status: 'production_disabled' };

    try {
        const result = await generateCourtesyTranslation(deps, {
            tenantId: input.tenantId,
            inspectionId: input.inspectionId,
            ...(input.reportId ? { reportId: input.reportId } : {}),
            locale: input.requestedLocale,
        });
        return {
            status: 'produced',
            reportId: result.reportId,
            locale: result.locale,
            segmentCount: result.segmentCount,
        };
    } catch (err) {
        // Swallowed HERE and nowhere else. The English report is published and
        // correct; a thrown error at this point would roll a successful publish
        // back over a reading aid. What must not be swallowed is the fact that
        // it failed, which is why the outcome is a value rather than a void.
        const reason = err instanceof Error ? err.message : 'unknown error';
        logger.warn('[translation] courtesy translation not produced on publish', {
            inspectionId: input.inspectionId,
            tenantId: input.tenantId,
            locale: input.requestedLocale,
            reason,
        });
        return { status: 'failed', locale: input.requestedLocale, reason };
    }
}

/**
 * The publish route's one line.
 *
 * Everything the hook needs is assembled here rather than in `publish.ts`,
 * which is at its large-file cap — and, more usefully, because "did the
 * publisher ask for a translation, and may this workspace make one" is this
 * module's question rather than the publish route's.
 *
 * ⚠️ The context type is `Context<HonoConfig>`, never a bare `Context`. A bare
 * one collapses `env` to `any` and takes every type error in the call with it.
 */
export async function translateOnPublishForRequest(
    c: Context<HonoConfig>,
    inspectionId: string,
    requestedLocale: string | null,
    reportId?: string,
): Promise<OnPublishTranslationOutcome> {
    const tenantId = c.get('tenantId') ?? '';
    if (!requestedLocale) return { status: 'not_requested' };
    return translateOnPublish(
        {
            db: c.env.DB,
            ai: c.var.services.ai,
            inspection: c.var.services.inspection,
            translations: c.var.services.reportTranslation,
        },
        {
            tenantId,
            inspectionId,
            ...(reportId ? { reportId } : {}),
            requestedLocale,
            productionEnabled: await isCourtesyTranslationEnabled(c.env.DB, tenantId),
        },
    );
}
