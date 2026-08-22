import { drizzle } from 'drizzle-orm/d1';
import { statutoryFormSightings } from '../../lib/db/schema/statutory-form-sightings';
import { logger } from '../../lib/logger';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import {
    classifySighting, sha256Hex,
    type RevisionSighting, type RevisionWatchTarget,
} from '../../lib/statutory/revision-watch';

/**
 * Polls the authority's page for each published statutory form and RECORDS what
 * it found. It publishes nothing.
 *
 * ── The one line of this file that matters ──────────────────────────────────
 * It never touches `statutory_form_versions`. A watcher that only reports costs
 * nothing on the day it misses a revision; one that replaces sends an inspector
 * a statutory form the state did not ask for, which they sign and file. That
 * asymmetry is why the write below goes to a different table with a different
 * shape — `statutory_form_sightings` cannot express an effective date or a
 * publisher, so nothing read out of it can be selected for rendering.
 *
 * ── Failure is per target, and is never silence ─────────────────────────────
 * An agency page is somebody else's server: it times out, it 404s after a site
 * rebuild, it serves an HTML error page with a 200. None of that may take the
 * scheduled invocation down, and none of it may look like "unchanged" either —
 * a poll that failed writes no sighting and logs the reason, so a page nobody
 * has successfully read for a month shows up as a `last_seen_at` that stopped
 * moving rather than as a run of reassuring rows.
 */
export class StatutoryRevisionWatchService {
    constructor(private readonly db: D1Database) {}

    /**
     * Poll one page and record what it served, or `null` if it could not be read.
     *
     * The bytes are hashed and dropped. We do not store the agency's PDF here:
     * storing it is part of publishing a revision, which is a decision this
     * class does not get to make.
     */
    async poll(target: RevisionWatchTarget, now: Date): Promise<RevisionSighting | null> {
        let bytes: ArrayBuffer;
        try {
            const response = await fetch(target.sourceUrl, { redirect: 'follow' });
            if (!response.ok) {
                // The status is recorded because the two common ones mean
                // different things: a 404 is a page that moved and a revision we
                // may now be alone in offering, a 503 is Tuesday.
                logger.warn('[statutory] revision watch could not read the source page', {
                    formId: target.formId, sourceUrl: target.sourceUrl, status: response.status,
                });
                return null;
            }
            bytes = await response.arrayBuffer();
        } catch (error) {
            logger.warn('[statutory] revision watch fetch failed', {
                formId: target.formId,
                sourceUrl: target.sourceUrl,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }

        const sighting = classifySighting(PUBLISHED_FORM_VERSIONS, {
            formId: target.formId,
            sourceUrl: target.sourceUrl,
            observedHash: await sha256Hex(new Uint8Array(bytes)),
            observedAt: now.getTime(),
        });
        await this.record(sighting, now);

        if (sighting.verdict !== 'unchanged') {
            // Loud, and deliberately not actionable by this software: what
            // happens next is a person reading the agency's form and authoring a
            // field map against it. There is no operator console to raise this
            // in yet, and inventing one from here would put the notice somewhere
            // nobody has agreed it belongs.
            logger.warn('[statutory] an authority page is serving bytes we do not publish', {
                formId: sighting.formId,
                sourceUrl: sighting.sourceUrl,
                observedHash: sighting.observedHash,
                verdict: sighting.verdict,
            });
        }
        return sighting;
    }

    /**
     * First sighting of some bytes inserts; every later sighting of the SAME
     * bytes moves `last_seen_at` only.
     *
     * `first_seen_at` is left alone on conflict on purpose — it is the answer to
     * "since when has this page been serving something we do not publish", and
     * an upsert that refreshed it would reset that clock on every poll and make
     * a month-old divergence read as this morning's.
     */
    private async record(sighting: RevisionSighting, now: Date): Promise<void> {
        await drizzle(this.db).insert(statutoryFormSightings)
            .values({
                id: crypto.randomUUID(),
                formId: sighting.formId,
                sourceUrl: sighting.sourceUrl,
                observedHash: sighting.observedHash,
                verdict: sighting.verdict,
                firstSeenAt: now,
                lastSeenAt: now,
            })
            .onConflictDoUpdate({
                target: [
                    statutoryFormSightings.formId,
                    statutoryFormSightings.sourceUrl,
                    statutoryFormSightings.observedHash,
                ],
                // The verdict is refreshed as well as the timestamp: bytes that
                // were `changed` yesterday become `unchanged` the moment somebody
                // publishes them, and a stale verdict would keep an answered
                // question looking open.
                set: { lastSeenAt: now, verdict: sighting.verdict },
            });
    }
}
