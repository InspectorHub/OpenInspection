// @vitest-environment happy-dom
/**
 * Two clicks on "Restore entire version" dispatched in one frame must call
 * `onRestoreWhole` once; the latch releases when `busy` returns to false.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { VersionCompare } from "./VersionCompare";

afterEach(cleanup);

function ui(onRestoreWhole: () => void, busy: boolean) {
    return (
        <VersionCompare
            open
            onClose={() => {}}
            fromLabel="Version #1"
            toLabel="Current"
            diffs={[]}
            onRestoreWhole={onRestoreWhole}
            busy={busy}
        />
    );
}

const restoreButton = () => screen.getByText("Restore entire version").closest("button") as HTMLButtonElement;

describe("VersionCompare in-flight latch", () => {
    it("restores once for two same-frame clicks, and again after busy settles", () => {
        const onRestoreWhole = vi.fn();
        const { rerender } = render(ui(onRestoreWhole, false));
        const btn = restoreButton();
        act(() => { btn.click(); btn.click(); });
        expect(onRestoreWhole).toHaveBeenCalledTimes(1);

        rerender(ui(onRestoreWhole, true));
        rerender(ui(onRestoreWhole, false));
        act(() => { restoreButton().click(); });
        expect(onRestoreWhole).toHaveBeenCalledTimes(2);
    });
});
