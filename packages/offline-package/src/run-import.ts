/**
 * Importing a package: send it, read the answer, split and resend until every
 * inspection in it is either imported or held back with a reason.
 *
 * Invariants, each pinned by a test:
 *  - Every input inspection ends in `imported` or `heldBack`, never both, never
 *    neither. A part is imported only on a confirmed 200.
 *  - Strictly serial: one request in flight at a time, and a confirmed part is
 *    never sent again.
 *  - Bounded: at most `MAX_ATTEMPTS_PER_PART` sends of one part, a total time
 *    budget for retries, and at most `inspections + 1` times that the answer sends
 *    the loop back to cut the package differently.
 *  - A refusal of the whole package stops the run. The parts not yet sent are held
 *    back with the same reason rather than dropped.
 */

import { classifyResponse, type Classified, type NeedsAttention, type SendResult } from './classify';
import { parsePackage, writePackageFor, type ParsedPackage } from './format';
import { planParsedParts } from './split';

export type { NeedsAttention, SendResult } from './classify';

/** Sends one package. Reports a refusal as a result; throws only when no answer was received. */
export type Send = (bytes: Uint8Array) => Promise<SendResult>;

export const MAX_ATTEMPTS_PER_PART = 5;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 15_000;
/** Once this much time has passed, a part that is not confirmed on its next send is given up on. */
export const MAX_RETRY_WINDOW_MS = 5 * 60 * 1000;

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

type Answer = { status?: number; code?: string };

const answerOf = (from: Answer): Answer => ({
    ...(from.status !== undefined ? { status: from.status } : {}),
    ...(from.code !== undefined ? { code: from.code } : {}),
});

function reasonFor(status: number, detail: string | undefined): HeldBackReason {
    if (status === 409) return 'deleted';
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
    const started = now();

    const imported: string[] = [];
    const heldBack: HeldBack[] = [];
    const needsAttention = new Map<string, NeedsAttention>();
    let applied = 0;
    let skipped = 0;
    let requests = 0;
    let reactions = 0;
    let settled = 0;
    const maxReactions = input.length + 1;
    let stopped: Answer | null = null;

    const queue: Unit[] = [{ ids: input, bytes: zip }];
    const hold = (ids: readonly string[], reason: HeldBackReason, from: Answer, detail?: string): void => {
        for (const id of ids) heldBack.push({ id, reason, ...answerOf(from), ...(detail !== undefined ? { detail } : {}) });
    };

    /** Send one part until it is confirmed, refused or the attempts run out. */
    const sendPart = async (bytes: Uint8Array): Promise<Classified | ({ kind: 'gave_up' } & Answer)> => {
        for (let attempt = 1; ; attempt++) {
            requests++;
            let classified: Classified;
            try {
                classified = classifyResponse(await send(bytes));
            } catch {
                // No usable answer: the part is not confirmed. Sending it again is safe.
                classified = { kind: 'retry' };
            }
            if (classified.kind !== 'retry') return classified;
            if (attempt >= MAX_ATTEMPTS_PER_PART || now() - started > MAX_RETRY_WINDOW_MS) return { kind: 'gave_up', ...answerOf(classified) };
            await sleep(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
        }
    };

    while (queue.length > 0) {
        const unit = queue.shift()!;
        if (stopped) {
            hold(unit.ids, 'package_rejected', stopped);
        } else {
            const outcome = await sendPart(unit.bytes ?? writePackageFor(parsed, new Set(unit.ids)));
            switch (outcome.kind) {
                case 'confirmed':
                    imported.push(...unit.ids);
                    applied += outcome.applied;
                    skipped += outcome.skipped;
                    for (const failure of outcome.failed) needsAttention.set(failure.idempotencyKey, failure);
                    break;
                case 'gave_up':
                    hold(unit.ids, 'gave_up', outcome);
                    break;
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
                        hold(named, reasonFor(outcome.status, outcome.reason), outcome, outcome.reason);
                        const rest = unit.ids.filter((id) => !named.includes(id));
                        if (rest.length > 0) queue.unshift({ ids: rest });
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
        }
        settled++;
        options.onProgress?.({ settled, imported: imported.length, heldBack: heldBack.length, pending: queue.length });
    }

    // Safety net for the first invariant: nothing the loop above handles can leave an inspection
    // unaccounted for, but if it ever did, the inspection is reported rather than lost.
    const accounted = new Set([...imported, ...heldBack.map((h) => h.id)]);
    for (const id of input) if (!accounted.has(id)) heldBack.push({ id, reason: 'gave_up' });

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
