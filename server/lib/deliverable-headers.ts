/**
 * The headers every live deliverable carries, in one place.
 *
 * -- WHY THIS IS ITS OWN MODULE ----------------------------------------------
 * `server/api/evidence.ts` states the hazard in its own header: THREE download
 * helpers, three independent `r2.get` calls, no shared fetch layer, and
 * "nothing in this file will tell you which one you missed". That is survivable
 * at three, because they sit next to each other and share this function.
 *
 * The statutory form is a FOURTH deliverable, and it lives on a different
 * route in a different file. Copying these headers there would turn one warning
 * about three helpers into a warning about four spread across two files -- and
 * the copy would be the one that silently stopped matching, because nothing
 * compares them. So the rule moves here and both callers read it, rather than
 * the newcomer carrying its own version.
 *
 * -- WHAT THE HEADERS ACTUALLY SAY -------------------------------------------
 * `x-artifact-status` says whether this object is still the current answer or
 * has been superseded by a published correction. The cache directives are part
 * of the same statement rather than a separate concern: a status header is a
 * claim about right now, and the `private, max-age=300` these used to send let
 * a response fetched before a correction keep claiming `current` for five
 * minutes after it landed.
 */
import {
    ARTIFACT_CACHE_CONTROL,
    ARTIFACT_STATUS_HEADER,
    resolveArtifactStatus,
} from './artifact-status';

export async function deliverableHeaders(
    d1: D1Database,
    tenantId: string,
    inspectionId: string,
    producedAt: Date | null,
    contentType: string,
    contentDisposition: string,
): Promise<Record<string, string>> {
    const status = await resolveArtifactStatus(d1, tenantId, inspectionId, producedAt);
    return {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        [ARTIFACT_STATUS_HEADER]: status,
        'Cache-Control': ARTIFACT_CACHE_CONTROL[status],
    };
}
