// @vitest-environment happy-dom
/**
 * A challenge script that failed to load must be reported to EVERY mount, not only the one that inserted it.
 *
 * `onLoadFailed` used to be wired only on the element the hook created, so when an earlier page inserted the script and it
 * failed, a later mount found the element, attached nothing, and never heard about it: the visitor saw a generic "required".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTurnstileWidget } from "~/lib/turnstile";

const scripts = () => [...document.head.querySelectorAll<HTMLScriptElement>('script[src*="turnstile"]')];

afterEach(() => {
    scripts().forEach((s) => s.remove());
});

function mount(onLoadFailed: () => void) {
    const host = document.createElement("div");
    return renderHook(() => useTurnstileWidget("site-key", { current: host }, 0, () => {}, { onLoadFailed }));
}

describe("turnstile script failure reaches later mounts", () => {
    it("tells the mount that inserted the script (the control)", () => {
        const failed = vi.fn();
        mount(failed);
        scripts()[0]!.dispatchEvent(new Event("error"));
        expect(failed).toHaveBeenCalledTimes(1);
    });

    it("tells a second mount that found the script still loading", () => {
        const first = vi.fn();
        const second = vi.fn();
        mount(first);
        mount(second);
        scripts()[0]!.dispatchEvent(new Event("error"));
        expect(second).toHaveBeenCalledTimes(1);
    });

    it("tells a mount that arrives after the failure, by trying the script again", () => {
        mount(() => {});
        scripts()[0]!.dispatchEvent(new Event("error"));
        const late = vi.fn();
        mount(late);
        // The failed element was dropped, so this mount inserted a fresh one and is listening to it.
        expect(scripts()).toHaveLength(1);
        scripts()[0]!.dispatchEvent(new Event("error"));
        expect(late).toHaveBeenCalledTimes(1);
    });
});
