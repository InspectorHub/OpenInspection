/**
 * What to tell a person about an inspection an offline-package import left behind.
 *
 * `runImport` reports a `reason` per inspection, plus the status and code of the
 * server answer that caused it. The reason alone is not enough to write the
 * sentence: a refusal of the whole package (`package_rejected`) is a signed-out
 * session, an expired package or a package dated ahead of the server, and each
 * has a different next step. The figures in the expired and future sentences are
 * the ones the server named (`details.maxAgeDays`, `details.maxFutureSkewDays`),
 * so the page never states a number the server did not.
 *
 * Messages are called inside the function, not at module load, so the locale
 * resolves per request.
 */
import { PACKAGE_MAX_AGE_DAYS, PACKAGE_MAX_FUTURE_SKEW_DAYS, type HeldBack } from "@core/offline-package";
import { m } from "~/paraglide/messages";

export interface HeldBackExplanation {
    /** Rows with the same group share one explanation, shown once above them. */
    group: string;
    /** Short label for the pill on each row. */
    label: string;
    what: string;
    next: string;
}

const positive = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

/** `404 NOT_FOUND`, `409`, or null when the import never got an answer. */
export function answerText(h: Pick<HeldBack, "status" | "code">): string | null {
    const text = [h.status, h.code].filter((part) => part !== undefined && part !== "").join(" ");
    return text === "" ? null : text;
}

function explainPackageRejected(h: HeldBack): HeldBackExplanation {
    const label = m.offline_import_reason_package_rejected();
    if (h.code === "PACKAGE_EXPIRED") {
        const days = positive(h.details?.maxAgeDays, PACKAGE_MAX_AGE_DAYS);
        return { group: "package_rejected:expired", label, what: m.offline_import_what_expired({ days }), next: m.offline_import_next_expired() };
    }
    if (h.code === "PACKAGE_FROM_THE_FUTURE") {
        const days = positive(h.details?.maxFutureSkewDays, PACKAGE_MAX_FUTURE_SKEW_DAYS);
        return { group: "package_rejected:future", label, what: days === 1 ? m.offline_import_what_future_one() : m.offline_import_what_future_other({ days }), next: m.offline_import_next_future() };
    }
    if (h.status === 401 || h.status === 403) {
        return { group: "package_rejected:session", label, what: m.offline_import_what_session(), next: m.offline_import_next_session() };
    }
    return { group: "package_rejected", label, what: m.offline_import_what_package_rejected(), next: m.offline_import_next_package_rejected() };
}

export function explainHeldBack(h: HeldBack): HeldBackExplanation {
    switch (h.reason) {
        case "package_rejected":
            return explainPackageRejected(h);
        case "not_found":
            return { group: h.reason, label: m.offline_import_reason_not_found(), what: m.offline_import_what_not_found(), next: m.offline_import_next_not_found() };
        case "forbidden":
            return { group: h.reason, label: m.offline_import_reason_forbidden(), what: m.offline_import_what_forbidden(), next: m.offline_import_next_forbidden() };
        case "different_report":
            return { group: h.reason, label: m.offline_import_reason_different_report(), what: m.offline_import_what_different_report(), next: m.offline_import_next_different_report() };
        case "deleted":
            return { group: h.reason, label: m.offline_import_reason_deleted(), what: m.offline_import_what_deleted(), next: m.offline_import_next_deleted() };
        case "apply_failed":
            return { group: h.reason, label: m.offline_import_reason_apply_failed(), what: m.offline_import_what_apply_failed(), next: m.offline_import_next_apply_failed() };
        case "refused":
            return { group: h.reason, label: m.offline_import_reason_refused(), what: m.offline_import_what_refused(), next: m.offline_import_next_refused() };
        case "too_large_to_split":
            return { group: h.reason, label: m.offline_import_reason_too_large(), what: m.offline_import_what_too_large(), next: m.offline_import_next_too_large() };
        case "gave_up":
            // `local_error` is the detail `runImport` sets when the failure was on this side, not the server's.
            return {
                group: h.detail === "local_error" ? "gave_up:local" : h.reason,
                label: m.offline_import_reason_gave_up(),
                what: h.detail === "local_error" ? m.offline_import_what_local() : m.offline_import_what_gave_up(),
                next: m.offline_import_next_gave_up(),
            };
    }
}

/** Held-back rows in the order their group first appears, each group once. */
export function groupHeldBack(rows: readonly HeldBack[]): Array<{ explanation: HeldBackExplanation; rows: HeldBack[] }> {
    const groups = new Map<string, { explanation: HeldBackExplanation; rows: HeldBack[] }>();
    for (const row of rows) {
        const explanation = explainHeldBack(row);
        const existing = groups.get(explanation.group);
        if (existing) existing.rows.push(row);
        else groups.set(explanation.group, { explanation, rows: [row] });
    }
    return [...groups.values()];
}
