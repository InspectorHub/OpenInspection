/**
 * A scripted stand-in for the import endpoint, for the specs of `runImport`.
 * It records every request, how many were in flight at once, and which
 * inspections it confirmed, so a spec can assert on what the logic did rather
 * than on what it was told to do.
 */
import { readPackageSummary, type ImportOptions, type ImportReport, type Send, type SendResult } from '@core/offline-package';
import { engineReads, type EngineView } from './offline-package-cases';

export type Respond = (call: number, ids: string[], bytes: Uint8Array) => SendResult | 'throw';

export interface Harness {
    send: Send;
    options: ImportOptions;
    /** The inspections of each request, in order. */
    calls: string[][];
    sleeps: number[];
    readonly maxInFlight: number;
    /** What the engine read out of each request's package. */
    views: EngineView[];
    /** Why the engine would refuse a request's package, for each one it would. Must stay empty. */
    invalid: string[];
    /** Ids the stand-in answered 200 for. */
    confirmed: Set<string>;
}

/** A well-formed 200 for the package `bytes`. */
export function confirmedFor(bytes: Uint8Array, overrides: { failed?: unknown[]; skipped?: number; applied?: number } = {}): SendResult {
    const { counts } = readPackageSummary(bytes);
    return {
        status: 200,
        body: {
            success: true,
            data: {
                inspections: counts.inspections,
                photos: counts.photos,
                outbox: { applied: overrides.applied ?? counts.writes, skipped: overrides.skipped ?? 0, failed: overrides.failed ?? [] },
                yjs: { changed: counts.inspections, unchanged: 0 },
            },
        },
    };
}

export function refusal(status: number, code: string, details?: Record<string, unknown>): SendResult {
    return { status, code, ...(details ? { details } : {}), body: { success: false, error: { code, message: code, ...(details ? { details } : {}) } } };
}

export function harness(respond: Respond): Harness {
    let inFlight = 0;
    let peak = 0;
    let clock = 0;
    const calls: string[][] = [];
    const views: EngineView[] = [];
    const sleeps: number[] = [];
    const confirmed = new Set<string>();
    const invalid: string[] = [];
    const send: Send = async (bytes) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        try {
            // Give a concurrent caller the chance to start a second request before this one answers.
            await Promise.resolve();
            await Promise.resolve();
            // A refusal here would read to the code under test as a network fault and hide the defect,
            // so an invalid part is recorded for the spec to assert on instead.
            const verdict = engineReads(bytes);
            if (verdict.ok) views.push(verdict.view);
            else invalid.push(verdict.reason);
            const ids = readPackageSummary(bytes).manifest.inspections.map((i) => i.id);
            calls.push(ids);
            const answer = respond(calls.length, ids, bytes);
            if (answer === 'throw') throw new Error('network down');
            if (answer.status === 200 && (answer.body as { data?: { outbox?: unknown } } | undefined)?.data?.outbox !== undefined) {
                for (const id of ids) confirmed.add(id);
            }
            return answer;
        } finally {
            inFlight--;
        }
    };
    return {
        send,
        options: {
            sleep: async (ms) => { sleeps.push(ms); clock += ms; },
            now: () => clock,
        },
        calls,
        sleeps,
        get maxInFlight() { return peak; },
        views,
        invalid,
        confirmed,
    };
}

/** Every input inspection is in `imported` or `heldBack`, and in only one of them, once. */
export function partitionProblems(report: ImportReport, input: readonly string[]): string[] {
    const problems: string[] = [];
    const imported = report.imported;
    const held = report.heldBack.map((h) => h.id);
    const all = [...imported, ...held];
    if (new Set(all).size !== all.length) problems.push(`an inspection appears more than once: ${all.join(',')}`);
    const missing = input.filter((id) => !all.includes(id));
    if (missing.length > 0) problems.push(`lost: ${missing.join(',')}`);
    const invented = all.filter((id) => !input.includes(id));
    if (invented.length > 0) problems.push(`not in the input: ${invented.join(',')}`);
    return problems;
}

/** The engine's view of `part` says each inspection in it carries exactly what the original carried. */
export function crossingProblems(original: EngineView, part: EngineView): string[] {
    const problems: string[] = [];
    for (const id of part.ids) {
        const writes = [...(part.writes.get(id) ?? [])].sort().join(',');
        const wasWrites = [...(original.writes.get(id) ?? [])].sort().join(',');
        if (writes !== wasWrites) problems.push(`${id}: writes ${writes} != ${wasWrites}`);
        const photos = [...(part.photos.get(id) ?? [])].sort().join(',');
        const wasPhotos = [...(original.photos.get(id) ?? [])].sort().join(',');
        if (photos !== wasPhotos) problems.push(`${id}: photos ${photos} != ${wasPhotos}`);
        const state = part.yjs.get(id);
        const was = original.yjs.get(id);
        if (!state || !was || state.length !== was.length || state.some((b, i) => b !== was[i])) problems.push(`${id}: Yjs state differs`);
        for (const pendingId of part.photos.get(id) ?? []) {
            const bytes = part.photoBytes.get(pendingId);
            const wasBytes = original.photoBytes.get(pendingId);
            if (!bytes || !wasBytes || bytes.length !== wasBytes.length || bytes.some((b, i) => b !== wasBytes[i])) problems.push(`${pendingId}: photo bytes differ`);
        }
    }
    return problems;
}
