/**
 * formatReplayToasts — pure helper that maps a ReplayResult to an array of
 * human-readable toast messages.
 *
 * Kept pure (no side-effects, no React imports) so it can be unit-tested
 * directly without a DOM environment.
 *
 * Rules:
 *   synced > 0   → "Synced N change(s)"
 *   conflicts > 0 → "N conflict(s) need review"
 *   failed > 0   → "N change(s) could not sync — open the sync panel to retry"
 *
 * Zero-valued fields produce no message.
 */

export interface ReplayToastEntry {
    message: string;
    /** "info" for success, "warn" for conflicts, "error" for failures */
    tone: "info" | "warn" | "error";
    durationMs: number;
}

export interface ReplayResultShape {
    synced: number;
    conflicts: number;
    failed: number;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatReplayToasts(result: ReplayResultShape): ReplayToastEntry[] {
    const toasts: ReplayToastEntry[] = [];

    if (result.synced > 0) {
        toasts.push({
            message: `Synced ${plural(result.synced, "change")}`,
            tone: "info",
            durationMs: 3000,
        });
    }

    if (result.conflicts > 0) {
        toasts.push({
            message: `${plural(result.conflicts, "conflict")} need review`,
            tone: "warn",
            durationMs: 6000,
        });
    }

    if (result.failed > 0) {
        toasts.push({
            message: `${plural(result.failed, "change")} could not sync — open the sync panel to retry`,
            tone: "error",
            durationMs: 8000,
        });
    }

    return toasts;
}
