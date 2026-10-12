// @vitest-environment happy-dom
/**
 * Two submits dispatched in one frame must reach `onSubmit` once.
 * `busy` has not rendered by the time the second one arrives, so the guard is
 * a ref released when `busy` returns to false.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { TagEditorModal } from "./TagEditorModal";

afterEach(cleanup);

function ui(busy: boolean, onSubmit: () => void) {
    return <TagEditorModal tag={null} open busy={busy} onClose={() => {}} onSubmit={onSubmit} />;
}

function form(): HTMLFormElement {
    const f = document.querySelector("form");
    if (!f) throw new Error("form not rendered");
    return f;
}

function submitTwice() {
    const f = form();
    act(() => {
        f.requestSubmit();
        f.requestSubmit();
    });
}

describe("TagEditorModal in-flight latch", () => {
    it("submits once when two submits land in one frame", () => {
        const onSubmit = vi.fn();
        render(ui(false, onSubmit));
        submitTwice();
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("releases when busy returns to false so a failed save can be retried", () => {
        const onSubmit = vi.fn();
        const { rerender } = render(ui(false, onSubmit));
        submitTwice();
        expect(onSubmit).toHaveBeenCalledTimes(1);
        rerender(ui(true, onSubmit));
        rerender(ui(false, onSubmit));
        act(() => { form().requestSubmit(); });
        expect(onSubmit).toHaveBeenCalledTimes(2);
    });
});
