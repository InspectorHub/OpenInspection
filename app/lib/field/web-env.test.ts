// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { webIsOnline, webNotify, webOnOnlineChange } from "./web-env";

describe("webOnOnlineChange", () => {
    it("reports online and offline events", () => {
        const cb = vi.fn();
        const off = webOnOnlineChange(cb);
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("online"));
        expect(cb.mock.calls).toEqual([[false], [true]]);
        off();
    });

    it("removes both listeners on unsubscribe", () => {
        const cb = vi.fn();
        const off = webOnOnlineChange(cb);
        off();
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("online"));
        expect(cb).not.toHaveBeenCalled();
    });
});

describe("webIsOnline", () => {
    it("follows navigator.onLine", () => {
        vi.stubGlobal("navigator", { onLine: false });
        expect(webIsOnline()).toBe(false);
        vi.stubGlobal("navigator", { onLine: true });
        expect(webIsOnline()).toBe(true);
        vi.unstubAllGlobals();
    });
});

describe("webNotify", () => {
    it("maps variants and durations to pushToast arguments", () => {
        const push = vi.fn();
        webNotify("a", "info", push);
        webNotify("b", "success", push);
        webNotify("c", "error", push);
        webNotify("d", undefined, push);
        expect(push.mock.calls.map((c) => c[0])).toEqual([
            { message: "a", variant: "neutral", durationMs: 2500 },
            { message: "b", variant: "success", durationMs: 2000 },
            { message: "c", variant: "error", durationMs: 8000 },
            { message: "d", variant: "neutral", durationMs: 2500 },
        ]);
    });

    it("lets a call replace the variant's default display time", () => {
        const push = vi.fn();
        webNotify("video", "error", push, { durationMs: 6000 });
        webNotify("plain", "error", push, {});
        expect(push.mock.calls.map((c) => c[0])).toEqual([
            { message: "video", variant: "error", durationMs: 6000 },
            { message: "plain", variant: "error", durationMs: 8000 },
        ]);
    });

    it("maps a warning to the warning toast with its own default time", () => {
        const push = vi.fn();
        webNotify("partial", "warning", push);
        expect(push.mock.calls.map((c) => c[0])).toEqual([{ message: "partial", variant: "warning", durationMs: 6000 }]);
    });

    it("hands an action to the toast as its label and handler, and adds none when there is none", () => {
        const push = vi.fn();
        const run = vi.fn();
        webNotify("rated", "info", push, { durationMs: 6000, action: { label: "Undo", run } });
        webNotify("plain", "info", push, { durationMs: 6000 });
        const [withAction, without] = push.mock.calls.map((c) => c[0]);
        expect(withAction).toMatchObject({ message: "rated", variant: "neutral", durationMs: 6000, actionLabel: "Undo" });
        withAction.onAction();
        expect(run).toHaveBeenCalledTimes(1);
        expect(without).toEqual({ message: "plain", variant: "neutral", durationMs: 6000 });
    });
});
