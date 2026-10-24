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

    it("lets a second Recover go through after the first, though the synchronous recovery never raises busy", async () => {
        // The real caller's recovery is synchronous: `busy` stays false throughout, so a latch that waits
        // for a busy change would leave every other Recover button (and Restore) dead after one click.
        const onRecoverField = vi.fn();
        render(
            <VersionCompare
                open
                onClose={() => {}}
                fromLabel="Version #1"
                toLabel="Current"
                diffs={[
                    { findingKey: "u:s:a", nestedChanged: false, scalarChanges: [{ field: "rating", from: "NI", to: "RR" }] },
                    { findingKey: "u:s:b", nestedChanged: false, scalarChanges: [{ field: "rating", from: "MA", to: "RR" }] },
                ]}
                onRecoverField={onRecoverField}
                onRestoreWhole={() => {}}
                busy={false}
            />,
        );
        const [first, second] = screen.getAllByText("Recover this value").map((el) => el.closest("button") as HTMLButtonElement);
        act(() => { first.click(); });
        await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
        act(() => { second.click(); });
        expect(onRecoverField).toHaveBeenCalledTimes(2);
        expect(onRecoverField).toHaveBeenLastCalledWith("u:s:b", "rating", "MA");
    });
});
