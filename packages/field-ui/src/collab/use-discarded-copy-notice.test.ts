// @vitest-environment happy-dom
// #478 — the editor shows a discard while it holds findings and has not been
// dismissed; dismissing one loss never hides the next.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { DiscardedCopyNotice, ResultsDocHandle } from "./results-doc-connection";
import { useDiscardedCopyNotice } from "./use-discarded-copy-notice";

afterEach(cleanup);

const NOTICE: DiscardedCopyNotice = { kind: "lineage", atMs: 1700000000000, itemCount: 3, backedUp: true };

function handleWith(discarded?: DiscardedCopyNotice): ResultsDocHandle | null {
    if (discarded === undefined) return null;
    return { doc: null, persistenceSynced: false, synced: false, discarded } as unknown as ResultsDocHandle;
}

describe("useDiscardedCopyNotice", () => {
    it("shows a discard with findings, hides it after dismiss, and shows a new one", () => {
        const hook = renderHook(({ discarded }) => useDiscardedCopyNotice(handleWith(discarded)), {
            initialProps: { discarded: NOTICE },
        });
        expect(hook.result.current.notice).toEqual(NOTICE);

        act(() => hook.result.current.dismiss());
        expect(hook.result.current.notice).toBeNull();

        // A NEW discard (a different time) shows again.
        hook.rerender({ discarded: { ...NOTICE, atMs: 1700000001000 } });
        expect(hook.result.current.notice?.atMs).toBe(1700000001000);
    });

    it("never shows a discard that held no findings, or no discard at all", () => {
        const empty = renderHook(() => useDiscardedCopyNotice(handleWith({ ...NOTICE, itemCount: 0 })));
        expect(empty.result.current.notice).toBeNull();
        const none = renderHook(() => useDiscardedCopyNotice(null));
        expect(none.result.current.notice).toBeNull();
    });
});
