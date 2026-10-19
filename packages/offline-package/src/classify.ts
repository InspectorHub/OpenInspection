/**
 * Reading the server's answer to one import request.
 *
 * Every answer falls into exactly one of five classes, and the class decides what
 * happens next. Getting a class wrong is the failure that matters: calling a
 * whole-package refusal "splittable" loops, and calling an answer "confirmed"
 * that was not one loses an inspection without a trace. So a 200 is confirmed
 * only when every field the report needs is present, and anything the function
 * cannot place is a retry, which is safe because an import is idempotent.
 */

import type { PartLimits } from './split';

/** What a transport reports about one request. It never throws for a refusal. */
export interface SendResult {
    status: number;
    code?: string;
    details?: unknown;
    /** The parsed JSON body, when there was one. */
    body?: unknown;
}

/** One queued write the server refused. The results and photos beside it were still imported. */
export interface NeedsAttention {
    idempotencyKey: string;
    op: string;
    inspectionId: string;
    status: number;
    /** Present when the write was not attempted. Unknown values are kept as they came. */
    reason?: string;
}

export type Classified =
    | { kind: 'confirmed'; applied: number; skipped: number; failed: NeedsAttention[] }
    /** The refusal names inspections: send those on their own and the rest without them. */
    | { kind: 'splittable'; ids: string[]; status: number; code?: string; reason?: string; queuedWrite?: boolean }
    /** The whole package is refused and splitting cannot help. */
    | { kind: 'fatal'; status: number; code?: string; details?: Record<string, unknown> }
    /**
     * Not confirmed and not refused for good: send the same part again after a pause.
     * `inspectionId`, `reason` and `queuedWrite` are what the failure said about the one inspection
     * it stopped on, kept so that a part which keeps failing there can be cut around it.
     * `inFlight` marks the answer that only means another request holds a queued write's key.
     */
    | { kind: 'retry'; status?: number; code?: string; inspectionId?: string; reason?: string; queuedWrite?: boolean; inFlight?: boolean }
    /** Over the server's limits; `limits` is what the refusal offered to split to, when it offered any. */
    | { kind: 'too_large'; limits: PartLimits | null; status: number; code?: string };

const IN_FLIGHT_REASON = 'idempotency_in_flight';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** The error code and details, from the result's own fields or from an `error` object in its body. */
function errorFields(result: SendResult): { code: string | undefined; details: Record<string, unknown> } {
    const nested = isRecord(result.body) && isRecord(result.body.error) ? result.body.error : {};
    const code = typeof result.code === 'string' ? result.code : typeof nested.code === 'string' ? nested.code : undefined;
    const raw = result.details ?? nested.details;
    return { code, details: isRecord(raw) ? raw : {} };
}

function readFailed(value: unknown): NeedsAttention[] | null {
    if (!Array.isArray(value)) return null;
    const out: NeedsAttention[] = [];
    for (const row of value) {
        if (!isRecord(row)) return null;
        const { idempotencyKey, op, inspectionId, status, reason } = row;
        if (typeof idempotencyKey !== 'string' || typeof op !== 'string' || typeof inspectionId !== 'string' || !isCount(status)) return null;
        out.push({ idempotencyKey, op, inspectionId, status, ...(typeof reason === 'string' ? { reason } : {}) });
    }
    return out;
}

function readConfirmed(body: unknown, expectedInspections: number | undefined): Classified | null {
    const data = isRecord(body) && isRecord(body.data) ? body.data : body;
    if (!isRecord(data) || !isRecord(data.outbox) || !isRecord(data.yjs)) return null;
    const { applied, skipped } = data.outbox;
    const failed = readFailed(data.outbox.failed);
    if (!isCount(data.inspections) || !isCount(data.photos) || !isCount(applied) || !isCount(skipped) || !failed) return null;
    // An answer that counts a different number of inspections than the part held is not about this part.
    if (expectedInspections !== undefined && data.inspections !== expectedInspections) return null;
    if (!isCount(data.yjs.changed) || !isCount(data.yjs.unchanged)) return null;
    return { kind: 'confirmed', applied, skipped, failed };
}

function readLimits(details: Record<string, unknown>): PartLimits | null {
    const raw = details.limits;
    if (!isRecord(raw)) return null;
    const { inspections, outbox, photos, compressedBytes } = raw;
    if (!isPositive(inspections) || !isPositive(outbox) || !isPositive(photos) || !isPositive(compressedBytes)) return null;
    const limits: PartLimits = { inspections, outbox, photos, compressedBytes };
    // `details.limit` names the one that was hit; the server sends a figure for entries and for
    // the unpacked size only there.
    if (isPositive(details.max)) {
        if (details.limit === 'entries') limits.entries = details.max;
        if (details.limit === 'uncompressedBytes') limits.uncompressedBytes = details.max;
    }
    return limits;
}

function namedInspections(details: Record<string, unknown>): string[] {
    const ids = Array.isArray(details.inspectionIds) ? details.inspectionIds.filter((v): v is string => typeof v === 'string') : [];
    if (ids.length > 0) return [...new Set(ids)];
    return typeof details.inspectionId === 'string' ? [details.inspectionId] : [];
}

/** What a transient failure said about the inspection it stopped on. */
function retryFor(answer: { status: number; code?: string }, details: Record<string, unknown>): Classified {
    const inspectionId = typeof details.inspectionId === 'string' ? details.inspectionId : undefined;
    const reason = typeof details.reason === 'string' ? details.reason : undefined;
    return {
        kind: 'retry',
        ...answer,
        ...(inspectionId !== undefined ? { inspectionId } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(typeof details.idempotencyKey === 'string' ? { queuedWrite: true } : {}),
        ...(reason === IN_FLIGHT_REASON ? { inFlight: true } : {}),
    };
}

/** The server turns a queued write's 408, 429 or 5xx into a 400 and keeps the original status in `details.status`. */
const isTransientStatus = (value: unknown): boolean => isCount(value) && (value === 408 || value === 429 || value >= 500);

/**
 * `expectedInspections` is the number of inspections the request carried. A 200 whose count
 * differs is not an answer about that request, so it is not a confirmation.
 */
export function classifyResponse(result: SendResult, expectedInspections?: number): Classified {
    const { status } = result;
    if (!Number.isInteger(status)) return { kind: 'retry' };
    if (status === 200) return readConfirmed(result.body, expectedInspections) ?? { kind: 'retry', status };
    // Any other success or redirect is not an answer this import can read.
    if (status < 400) return { kind: 'retry', status };

    const { code, details } = errorFields(result);
    const answer = { status, ...(code ? { code } : {}) };

    if (status === 413 || (status === 422 && code === 'PACKAGE_TOO_LARGE')) return { kind: 'too_large', limits: readLimits(details), ...answer };
    // Their figures (`maxAgeDays`, `maxFutureSkewDays`) are kept so a page can say how old a package may be.
    if (code === 'PACKAGE_EXPIRED' || code === 'PACKAGE_FROM_THE_FUTURE') return { kind: 'fatal', ...answer, ...(Object.keys(details).length > 0 ? { details } : {}) };
    if (status === 409 && code === 'PACKAGE_INSPECTION_DELETED') {
        const ids = namedInspections(details);
        return ids.length > 0 ? { kind: 'splittable', ids, ...answer } : { kind: 'fatal', ...answer };
    }
    if (status === 409 && details.reason === IN_FLIGHT_REASON) return retryFor(answer, details);
    // A failure while applying one inspection's data (503 with its id) may have written part of
    // the package. Repeating the whole part is safe because every step is idempotent.
    if (status === 408 || status === 429 || status >= 500) return retryFor(answer, details);
    // A queued write that was rate limited or timed out is reported as a 400 naming the write.
    if (typeof details.idempotencyKey === 'string' && isTransientStatus(details.status)) return retryFor(answer, details);

    const ids = namedInspections(details);
    if (ids.length > 0) {
        return {
            kind: 'splittable', ids, ...answer,
            ...(typeof details.reason === 'string' ? { reason: details.reason } : {}),
            ...(typeof details.idempotencyKey === 'string' ? { queuedWrite: true } : {}),
        };
    }
    return { kind: 'fatal', ...answer };
}
