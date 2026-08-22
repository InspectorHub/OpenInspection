/**
 * Whether a stored deliverable is still the current answer, and whether a
 * correction may be delayed for it.
 *
 * ── Why this is one module rather than three copies ─────────────────────────
 * The signing workflow leaves three files in object storage for an envelope —
 * the signed PDF, the Certificate of Completion, and the evidence zip — and
 * each is served by its own helper in `server/api/evidence.ts` running its own
 * `r2.get`. There is no shared fetch layer, so a rule written at the fetch
 * site gets written three times, and the day one of them is missed nothing in
 * that file says so. The list, the classifier and the guard live here so the
 * three helpers consume one answer instead of each deriving their own.
 *
 * ── The classifier has no archive class, on purpose ─────────────────────────
 * Correction obligations commonly give softer treatment to archived or backup
 * systems. These three objects are not that: they are files the product hands
 * to a client whenever the client asks for them. Nothing in this deployment
 * writes an object it treats as an archive or a backup, so `ArtifactClass` has
 * no member for one — which means no key can be labelled as one by accident,
 * and a caller that asks to defer a correction gets a refusal rather than a
 * quiet delay. That refusal is the whole point of `assertNothingDeferred`: it
 * is the only rule here that speaks on a day nobody has had yet.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq } from 'drizzle-orm';
import { reportVersions } from './db/schema';
import { r2Keys } from './r2-keys';

/**
 * The files an envelope's signing workflow leaves behind and the product
 * serves back on request. Order is the order they are produced in.
 */
export const LIVE_DELIVERABLE_FILES = ['signed.pdf', 'certificate.pdf', 'evidence.zip'] as const;

/**
 * What a stored object is, for the purpose of deciding whether a correction
 * may be delayed for it.
 *
 * `unclassified` is not a synonym for "archive" — it means this module does
 * not recognise the key, and an unrecognised object is refused for the same
 * reason a recognised one is: nothing here can promise what deferring it would
 * mean.
 */
export type ArtifactClass = 'live' | 'unclassified';

/**
 * What a served deliverable claims about itself.
 *
 * `current` and `superseded` are both positive statements. The absence of a
 * status is a third thing entirely — an artefact nothing has classified — and
 * a reader must be able to tell it from `superseded`, which is why every 200
 * from the three download helpers carries one of these two values and never an
 * empty string.
 */
export type ArtifactStatus = 'current' | 'superseded';

/** Header carrying `ArtifactStatus`. One spelling, so three helpers agree. */
export const ARTIFACT_STATUS_HEADER = 'x-artifact-status';

/**
 * Cache directives that keep the status header honest.
 *
 * A status header is a claim about right now, so it is only true if the
 * response cannot be reused without asking again. `private, max-age=300` —
 * what all three helpers used to send — let a copy fetched a minute before a
 * correction go on claiming `current` for five minutes afterwards inside the
 * client's own cache, which is exactly the window a correction obligation is
 * meant to close.
 */
export const ARTIFACT_CACHE_CONTROL: Record<ArtifactStatus, string> = {
    // Storable, but revalidated before every reuse.
    current: 'private, no-cache, must-revalidate',
    // Not stored at all. The copy somebody already downloaded is out of our
    // hands; we do not add to the pile.
    superseded: 'private, no-store',
};

/** Every live deliverable key for one envelope. Three, always. */
export function liveDeliverableKeys(
    tenantId: string,
    inspectionId: string,
    envelopeId: string,
): string[] {
    return LIVE_DELIVERABLE_FILES.map((file) =>
        r2Keys.agreementFile(tenantId, inspectionId, envelopeId, file));
}

/** `…/agreements/{envelopeId}/{one of the three files}`. */
const LIVE_DELIVERABLE_KEY_RE = new RegExp(
    `/agreements/[^/]+/(?:${LIVE_DELIVERABLE_FILES.join('|').replace(/\./g, '\\.')})$`,
);

/**
 * What a stored object is. Recognised by key SHAPE rather than by a stored
 * label, so an object cannot be reclassified by editing a row.
 */
export function artifactClass(key: string): ArtifactClass {
    return LIVE_DELIVERABLE_KEY_RE.test(key) ? 'live' : 'unclassified';
}

/**
 * Refuse to carry out a correction while holding some of its objects back.
 *
 * Both branches throw, and the messages differ because the reasons do: a live
 * deliverable may not be deferred because it is not an archive, and anything
 * else may not be deferred because this module cannot say what it is.
 */
export function assertNothingDeferred(deferKeys: readonly string[]): void {
    for (const key of deferKeys) {
        if (artifactClass(key) === 'live') {
            throw new Error(
                `Refusing to defer ${key}: a live deliverable is not an archived or backup ` +
                'system, so a correction may not be delayed for it.',
            );
        }
        throw new Error(
            `Refusing to defer ${key}: this deployment classifies no stored object as an ` +
            'archive or a backup, so there is nothing a correction may be deferred for.',
        );
    }
}

/**
 * Whether the deliverables produced for an inspection at `producedAt` are
 * still the current answer.
 *
 * Derived from the amendment ledger rather than from a flag on the object: a
 * published amendment is the only durable record that what was delivered has
 * been superseded, and reading it means nothing has to remember to stamp the
 * three files. Deliberately OVER-inclusive — ANY amendment published after the
 * artefact marks it superseded, not only one raised as a correction. The two
 * mistakes are not symmetric: labelling a still-accurate artefact `superseded`
 * costs a reader one extra look, while labelling a superseded one `current` is
 * the failure the label exists to prevent.
 */
export async function resolveArtifactStatus(
    d1: D1Database,
    tenantId: string,
    inspectionId: string,
    producedAt: Date | null,
): Promise<ArtifactStatus> {
    // A deliverable with no production time on record cannot be shown to
    // predate any amendment, so it is judged against every one of them.
    const db = drizzle(d1);
    const latest = await db.select({ publishedAt: reportVersions.publishedAt })
        .from(reportVersions)
        .where(and(
            eq(reportVersions.tenantId, tenantId),
            eq(reportVersions.inspectionId, inspectionId),
            eq(reportVersions.isAmendment, true),
        ))
        .orderBy(desc(reportVersions.publishedAt))
        .limit(1)
        .get();
    if (!latest?.publishedAt) return 'current';
    if (!producedAt) return 'superseded';
    return latest.publishedAt.getTime() > producedAt.getTime() ? 'superseded' : 'current';
}
