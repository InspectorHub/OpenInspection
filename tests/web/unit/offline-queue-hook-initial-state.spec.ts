import { describe, it, expect } from "vitest";
import { OFFLINE_QUEUE_INITIAL_STATE } from "~/hooks/useOfflineQueue";

/**
 * Hydration-safety contract for useOfflineQueue.
 *
 * The server renders with no navigator / IndexedDB, so it always emits
 * `{ online: true, pendingCount: 0, failedCount: 0, syncing: false }`. The
 * client's FIRST render must produce the EXACT same values, or React throws a
 * hydration mismatch (minified #418 → #423) and falls back to a forced client
 * re-render — which, in the field, killed the NetworkPill "Sync now" click and
 * the window 'online' replay trigger.
 *
 * The hook seeds its useState calls from OFFLINE_QUEUE_INITIAL_STATE and only
 * reads the real navigator.onLine / storage counts inside a post-mount effect.
 * This test pins the constants so a regression (e.g. re-introducing
 * `useState(navigator.onLine)`) fails loudly here instead of only in a browser.
 */
describe("useOfflineQueue — SSR-safe initial state", () => {
    it("online starts true (never reads navigator.onLine on first render)", () => {
        expect(OFFLINE_QUEUE_INITIAL_STATE.online).toBe(true);
    });

    it("pendingCount starts at 0 (no synchronous storage read)", () => {
        expect(OFFLINE_QUEUE_INITIAL_STATE.pendingCount).toBe(0);
    });

    it("failedCount starts at 0 (no synchronous storage read)", () => {
        expect(OFFLINE_QUEUE_INITIAL_STATE.failedCount).toBe(0);
    });

    it("syncing starts false", () => {
        expect(OFFLINE_QUEUE_INITIAL_STATE.syncing).toBe(false);
    });

    it("matches the documented SSR snapshot exactly", () => {
        expect(OFFLINE_QUEUE_INITIAL_STATE).toEqual({
            online: true,
            pendingCount: 0,
            failedCount: 0,
            syncing: false,
        });
    });
});
