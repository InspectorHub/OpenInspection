import { describe, it, expect } from "vitest";
import { formatReplayToasts } from "~/lib/offline/replay-toasts";

describe("formatReplayToasts", () => {
    it("returns empty array when all counts are zero", () => {
        const result = formatReplayToasts({ synced: 0, conflicts: 0, failed: 0 });
        expect(result).toHaveLength(0);
    });

    it("produces a single info toast for synced changes (singular)", () => {
        const result = formatReplayToasts({ synced: 1, conflicts: 0, failed: 0 });
        expect(result).toHaveLength(1);
        expect(result[0].tone).toBe("info");
        expect(result[0].message).toBe("Synced 1 change");
        expect(result[0].durationMs).toBe(3000);
    });

    it("uses plural form for synced count > 1", () => {
        const result = formatReplayToasts({ synced: 5, conflicts: 0, failed: 0 });
        expect(result[0].message).toBe("Synced 5 changes");
    });

    it("produces a warn toast for conflicts (singular)", () => {
        const result = formatReplayToasts({ synced: 0, conflicts: 1, failed: 0 });
        expect(result).toHaveLength(1);
        expect(result[0].tone).toBe("warn");
        // Spec: "${conflicts} conflict${s} need review" — verb stays "need" for all counts.
        expect(result[0].message).toBe("1 conflict need review");
        expect(result[0].durationMs).toBe(6000);
    });

    it("uses plural form for conflicts > 1", () => {
        const result = formatReplayToasts({ synced: 0, conflicts: 3, failed: 0 });
        expect(result[0].message).toBe("3 conflicts need review");
    });

    it("produces an error toast for failed changes (singular)", () => {
        const result = formatReplayToasts({ synced: 0, conflicts: 0, failed: 1 });
        expect(result).toHaveLength(1);
        expect(result[0].tone).toBe("error");
        expect(result[0].message).toBe(
            "1 change could not sync — open the sync panel to retry",
        );
        expect(result[0].durationMs).toBe(8000);
    });

    it("uses plural form for failed > 1", () => {
        const result = formatReplayToasts({ synced: 0, conflicts: 0, failed: 2 });
        expect(result[0].message).toBe(
            "2 changes could not sync — open the sync panel to retry",
        );
    });

    it("returns all three toasts when all counts are non-zero", () => {
        const result = formatReplayToasts({ synced: 3, conflicts: 2, failed: 1 });
        expect(result).toHaveLength(3);
        const tones = result.map((t) => t.tone);
        expect(tones).toEqual(["info", "warn", "error"]);
    });

    it("preserves ordering: info, warn, error", () => {
        const result = formatReplayToasts({ synced: 10, conflicts: 2, failed: 4 });
        expect(result[0].tone).toBe("info");
        expect(result[1].tone).toBe("warn");
        expect(result[2].tone).toBe("error");
    });
});
