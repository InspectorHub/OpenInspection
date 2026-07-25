// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dedupeBucketMembership, BUCKET_PRIORITY } from "~/lib/dashboard-buckets";

const i = (id: string) => ({ id });

/**
 * Measured on /inspections with one inspection in the workspace: the list showed
 * two rows for it, one under "TODAY / Scheduled for today" and one under "RECENT
 * REPORTS / Recently completed", each with its own checkbox, both badged
 * `completed`. The buckets overlap on purpose — the stat cards count them as
 * separate lenses — but a list that shows one thing twice is telling the reader
 * there are two.
 */
describe("dedupeBucketMembership", () => {
    it("keeps an inspection in one bucket only", () => {
        const out = dedupeBucketMembership({
            today: [i("a")],
            recentReports: [i("a")],
        });
        expect(out.today).toBeUndefined();
        expect(out.recentReports?.map((x) => x.id)).toEqual(["a"]);
    });

    it("says the finished thing is a report, not a plan for today", () => {
        // This is the pair that was measured: the row under "Scheduled for
        // today" was already completed, so the group name contradicted the badge.
        expect(BUCKET_PRIORITY.indexOf("recentReports")).toBeLessThan(BUCKET_PRIORITY.indexOf("today"));
    });

    it("surfaces something needing attention over its date", () => {
        const out = dedupeBucketMembership({
            needsAttention: [i("a")],
            today: [i("a")],
            later: [i("a")],
        });
        expect(Object.keys(out)).toEqual(["needsAttention"]);
    });

    it("leaves distinct inspections in their own buckets", () => {
        const out = dedupeBucketMembership({
            today: [i("a"), i("b")],
            recentReports: [i("c")],
        });
        expect(out.today?.map((x) => x.id)).toEqual(["a", "b"]);
        expect(out.recentReports?.map((x) => x.id)).toEqual(["c"]);
    });

    it("drops a bucket that loses everything, so no heading sits above nothing", () => {
        const out = dedupeBucketMembership({
            recentReports: [i("a")],
            today: [i("a")],
            thisWeek: [],
        });
        expect(out.today).toBeUndefined();
        expect(out.thisWeek).toBeUndefined();
    });

    it("keeps the caller's key order, which is the render order", () => {
        const out = dedupeBucketMembership({
            today: [i("b")],
            needsAttention: [i("a")],
            recentReports: [i("c")],
        });
        expect(Object.keys(out)).toEqual(["today", "needsAttention", "recentReports"]);
    });

    it("does not silently drop a bucket the API adds later", () => {
        // Unranked buckets are never PREFERRED, but they still render — losing a
        // new bucket entirely would be a worse failure than showing it last.
        const out = dedupeBucketMembership({ somethingNew: [i("a")] });
        expect(out.somethingNew?.map((x) => x.id)).toEqual(["a"]);
    });

    it("prefers a ranked bucket over an unranked one", () => {
        const out = dedupeBucketMembership({ somethingNew: [i("a")], today: [i("a")] });
        expect(Object.keys(out)).toEqual(["today"]);
    });
});
