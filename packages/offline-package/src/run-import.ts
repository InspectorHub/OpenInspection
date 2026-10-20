/**
 * Importing a package: send it, read the answer, split and resend until every
 * inspection in it is either imported or held back with a reason.
 *
 * Invariants, each pinned by a test:
 *  - Every input inspection ends in `imported` or `heldBack`, never both, never
 *    neither. A part is imported only on a confirmed 200.
 *  - Strictly serial: one request in flight at a time, and a confirmed part is
 *    never sent again.
 *  - Bounded: at most `MAX_ATTEMPTS_PER_PART` failed sends of one part, a time
 *    window per part (measured from that part's own first send), and a longer
 *    wait, inside the same window, for a key another request holds. Every answer
 *    that sends the loop back to cut the package differently leaves strictly
 *    smaller units, so the loop ends by itself; `maxReactions` is only a backstop
 *    that no run reaches.
 *  - A refusal of the whole package stops the run. The parts not yet sent are held
 *    back with the same reason rather than dropped.
 *  - Nothing a callback or the cutting code throws can lose an inspection: what was
 *    imported stays imported and the rest is held back as `gave_up`.
 */

import { classifyResponse, type Classified, type NeedsAttention, type SendResult } from './classify';
import { parsePackage, writePackageFor, type ParsedPackage } from './format';
import { planParsedParts } from './split';

export type { NeedsAttention, SendResult } from './classify';

/**
 * Sends one package. Reports a refusal as a result; throws only when no answer was received.
 *
 * The transport owns the request's timeout and its cancellation: `runImport` waits for the
 * promise and never aborts it, so a transport that can hang forever hangs the import. A
 * request that is abandoned by a timeout should reject (it is then sent again).
 */
export type Send = (bytes: Uint8Array) => Promise<SendResult>;

export const MAX_ATTEMPTS_PER_PART = 5;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 15_000;
/**
 * Once this much time has passed since a part was first sent, that part is not sent again after
 * a failure. A key held by another request is waited for until the pauses add up to this much.
 */
export const MAX_RETRY_WINDOW_MS = 5 * 60 * 1000;
/** The `detail` of an inspection left behind because code on this side failed, not the server. */
const LOCAL_ERROR = 'local_error';

export type HeldBackReason =
    | 'not_found'
    | 'forbidden'
    | 'different_report'
    | 'deleted'
    | 'apply_failed'
    /** The server refused it by name for a reason this version does not know. */
    | 'refused'
    | 'too_large_to_split'
    /** The whole package was refused (another workspace, expired, a malformed entry). */
    | 'package_rejected'
    /** Never confirmed within the attempts and time allowed. */
    | 'gave_up';

export interface HeldBack {
    id: string;
    reason: HeldBackReason;
    status?: number;
    code?: string;
    /** The server's own `details.reason`, when it gave one. */
    detail?: string;
    /** The figures of a refusal of the whole package (`maxAgeDays`, `maxFutureSkewDays`), when it gave any. */
    details?: Record<string, unknown>;
}

export interface ImportReport {
    /** Inspections in parts the server confirmed, in manifest order. */
    imported: string[];
    /** Inspections not imported, each with the reason. Retrievable with `extractHeldBackPackage`. */
    heldBack: HeldBack[];
    /** Queued writes the server had already applied. */
    skipped: number;
    /** Queued writes executed by this import. */
    applied: number;
    /** Queued writes the server refused. They were not resent; their results and photos were imported. */
    needsAttention: NeedsAttention[];
    /** Requests sent, retries included. */
    requests: number;
}

export interface ImportOptions {
    /** Waits between retries. Injected so a test does not wait. */
    sleep?: (ms: number) => Promise<void>;
    /** The clock the retry window is measured on. */
    now?: () => number;
    /** Called after each part is settled. */
    onProgress?: (progress: { settled: number; imported: number; heldBack: number; pending: number }) => void;
}

interface Unit {
    ids: string[];
    bytes?: Uint8Array;
}

type Answer = { status?: number; code?: string; details?: Record<string, unknown> };

/** A part the retries ran out on, with what its last failure said about the inspection it stopped at. */
type GaveUp = { kind: 'gave_up'; inspectionId?: string; reason?: string; queuedWrite?: boolean; inFlight?: boolean } & Answer;

const answerOf = (from: Answer): Answer => ({
    ...(from.status !== undefined ? { status: from.status } : {}),
    ...(from.code !== undefined ? { code: from.code } : {}),
    ...(from.details !== undefined ? { details: from.details } : {}),
});

function reasonFor(status: number, code: string | undefined, detail: string | undefined, queuedWrite: boolean | undefined): HeldBackReason {
    // A queued write's refusal is about the write, whatever status it came back with.
    if (queuedWrite) return 'apply_failed';
    if (status === 409 && code === 'PACKAGE_INSPECTION_DELETED') return 'deleted';
    if (status === 404) return 'not_found';
    if (status === 403) return 'forbidden';
    if (detail !== undefined) return 'apply_failed';
    return status === 400 ? 'different_report' : 'refused';
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function runImport(zip: Uint8Array, send: Send, options: ImportOptions = {}): Promise<ImportReport> {
    const parsed: ParsedPackage = parsePackage(zip);
    const input = parsed.manifest.inspections.map((i) => i.id);
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;

    const imported: string[] = [];
    const heldBack: HeldBack[] = [];
    const needsAttention = new Map<string, NeedsAttention>();
    let applied = 0;
    let skipped = 0;
    let requests = 0;
    let reactions = 0;
    let settled = 0;
    // Every reaction either holds back at least one inspection (at most n of them) or cuts a unit
    // into strictly smaller ones (fewer than n: the cut has at most n leaves). So 2n is the true
    // bound; this is a backstop above it, never a limit a real run is held to.
    const maxReactions = 4 * input.length + 4;
    let stopped: Answer | null = null;

    const queue: Unit[] = [{ ids: input, bytes: zip }];
    const hold = (ids: readonly string[], reason: HeldBackReason, from: Answer, detail?: string): void => {
        for (const id of ids) heldBack.push({ id, reason, ...answerOf(from), ...(detail !== undefined ? { detail } : {}) });
    };

    /**
     * Send one part until it is confirmed, refused or the retries run out. The window is the
     * part's own: it starts at this part's first send, not at the start of the import.
     */
    const sendPart = async (bytes: Uint8Array, expectedInspections: number): Promise<Classified | GaveUp> => {
        const partStarted = now();
        let waited = 0;
        let failures = 0;
        for (let attempt = 1; ; attempt++) {
            requests++;
            let classified: Classified;
            try {
                classified = classifyResponse(await send(bytes), expectedInspections);
            } catch {
                // No usable answer: the part is not confirmed. Sending it again is safe.
                classified = { kind: 'retry' };
            }
            if (classified.kind !== 'retry') return classified;
            const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt - 1, 20));
            const outOfTime = now() - partStarted > MAX_RETRY_WINDOW_MS;
            // A key another request holds is released when that request ends, so it is waited for
            // by the clock; the pauses are summed too, so an injected clock cannot make this endless.
            const exhausted = classified.inFlight
                ? outOfTime || waited + delay > MAX_RETRY_WINDOW_MS
                : outOfTime || ++failures >= MAX_ATTEMPTS_PER_PART;
            if (exhausted) return { ...classified, kind: 'gave_up' };
            await sleep(delay);
            waited += delay;
        }
    };

    /** Runs the whole queue. Anything it throws is handled by the caller. */
    const drain = async (): Promise<void> => {
        while (queue.length > 0) {
            const unit = queue.shift()!;
            if (stopped) {
                hold(unit.ids, 'package_rejected', stopped);
            } else {
                await settle(unit);
            }
            settled++;
            options.onProgress?.({ settled, imported: imported.length, heldBack: heldBack.length, pending: queue.length });
        }
    };

    /**
     * Hold back `named` (a subset of the unit) and put the rest back to be sent without them.
     * Every use takes at least one inspection out of the unit, which is what keeps the loop finite.
     */
    const cutAway = (unit: Unit, named: readonly string[], reason: HeldBackReason, from: Answer, detail: string | undefined): void => {
        hold(named, reason, from, detail);
        const rest = unit.ids.filter((id) => !named.includes(id));
        if (rest.length > 0) queue.unshift({ ids: rest });
    };

    const settle = async (unit: Unit): Promise<void> => {
        const outcome = await sendPart(unit.bytes ?? writePackageFor(parsed, new Set(unit.ids)), unit.ids.length);
        switch (outcome.kind) {
            case 'confirmed':
                imported.push(...unit.ids);
                applied += outcome.applied;
                skipped += outcome.skipped;
                for (const failure of outcome.failed) needsAttention.set(failure.idempotencyKey, failure);
                break;
            case 'gave_up': {
                // A part that keeps failing on one inspection it names, with a reason of the server's
                // own, is not lost with it: that one is left behind and the others are sent again.
                // Trade-off, on purpose: when the whole backend is failing (a 503 on every part), each
                // inspection in turn can be cut away this way and ends as `apply_failed` rather than
                // `gave_up`. Nothing is lost by that, because a held-back inspection is retrievable
                // with `extractHeldBackPackage` and importing it again is idempotent.
                const culprit = outcome.inspectionId;
                if (
                    culprit !== undefined && unit.ids.includes(culprit) && !outcome.inFlight
                    && (outcome.reason !== undefined || outcome.queuedWrite === true) && reactions < maxReactions
                ) {
                    reactions++;
                    cutAway(unit, [culprit], 'apply_failed', outcome, outcome.reason);
                } else {
                    hold(unit.ids, 'gave_up', outcome);
                }
                break;
            }
            case 'retry':
                // sendPart never returns a retry; kept so a new class cannot fall through silently.
                hold(unit.ids, 'gave_up', outcome);
                break;
            case 'fatal':
                stopped = answerOf(outcome);
                hold(unit.ids, 'package_rejected', stopped);
                break;
            case 'splittable': {
                reactions++;
                const inPart = new Set(unit.ids);
                const named = outcome.ids.filter((id) => inPart.has(id));
                if (reactions > maxReactions) {
                    hold(unit.ids, 'gave_up', outcome);
                } else if (named.length === 0) {
                    // Names something this part does not hold: nothing can be cut away to make progress.
                    stopped = answerOf(outcome);
                    hold(unit.ids, 'package_rejected', stopped);
                } else {
                    cutAway(unit, named, reasonFor(outcome.status, outcome.code, outcome.reason, outcome.queuedWrite), outcome, outcome.reason);
                }
                break;
            }
            case 'too_large': {
                reactions++;
                if (reactions > maxReactions) {
                    hold(unit.ids, 'gave_up', outcome);
                    break;
                }
                const halves = (): Unit[] => {
                    const half = Math.ceil(unit.ids.length / 2);
                    return [{ ids: unit.ids.slice(0, half) }, { ids: unit.ids.slice(half) }];
                };
                let next: Unit[];
                if (outcome.limits) {
                    const plan = planParsedParts(parsed, unit.ids, outcome.limits);
                    hold(plan.tooLarge, 'too_large_to_split', outcome);
                    const sameAsSent = plan.parts.length === 1 && plan.parts[0]!.ids.length === unit.ids.length;
                    // The limits did not shrink anything: the server is counting something the limits
                    // do not name, so cut in half instead of sending the same part again.
                    next = sameAsSent && unit.ids.length > 1 ? halves() : plan.parts.map((p) => ({ ids: p.ids, bytes: p.bytes }));
                    if (sameAsSent && unit.ids.length === 1) {
                        heldBack.push({ id: unit.ids[0]!, reason: 'too_large_to_split', ...answerOf(outcome) });
                        next = [];
                    }
                } else if (unit.ids.length > 1) {
                    next = halves();
                } else {
                    hold(unit.ids, 'too_large_to_split', outcome);
                    next = [];
                }
                queue.unshift(...next);
                break;
            }
        }
    };

    let failedLocally = false;
    try {
        await drain();
    } catch {
        // The parts, the callback or the cutting code failed on this side. What the server confirmed
        // stays imported; everything else is left behind below instead of rejecting the whole run.
        failedLocally = true;
    }

    // Safety net for the first invariant: nothing the loop above handles can leave an inspection
    // unaccounted for, but if it ever did, the inspection is reported rather than lost.
    const accounted = new Set([...imported, ...heldBack.map((h) => h.id)]);
    for (const id of input) {
        if (!accounted.has(id)) heldBack.push({ id, reason: 'gave_up', ...(failedLocally ? { detail: LOCAL_ERROR } : {}) });
    }

    const order = new Map(input.map((id, i) => [id, i] as const));
    const byManifest = (a: string, b: string): number => (order.get(a) ?? 0) - (order.get(b) ?? 0);
    return {
        imported: imported.sort(byManifest),
        heldBack: heldBack.sort((a, b) => byManifest(a.id, b.id)),
        skipped,
        applied,
        needsAttention: [...needsAttention.values()],
        requests,
    };
}
