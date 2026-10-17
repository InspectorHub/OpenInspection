// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFetcherResult } from "./useFetcherResult";

type F = { state: string; data: { ok: boolean } | undefined };

describe("useFetcherResult", () => {
    it("ignores a result already present at mount, as a modal remounted over its parent's fetcher sees", () => {
        const handler = vi.fn();
        renderHook(() => useFetcherResult({ state: "idle", data: { ok: true } }, handler));
        expect(handler).not.toHaveBeenCalled();
    });

    it("handles each new result once, however often the handler changes, and not while submitting", () => {
        const handler = vi.fn();
        const first = { ok: true };
        const { rerender } = renderHook(
            ({ f }: { f: F }) => useFetcherResult(f, (d) => handler(d)),
            { initialProps: { f: { state: "idle", data: undefined } as F } },
        );
        rerender({ f: { state: "submitting", data: undefined } });
        rerender({ f: { state: "idle", data: first } });
        rerender({ f: { state: "idle", data: first } });
        rerender({ f: { state: "idle", data: first } });
        expect(handler).toHaveBeenCalledTimes(1);
        const second = { ok: true };
        rerender({ f: { state: "idle", data: second } });
        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler).toHaveBeenLastCalledWith(second);
    });
});
