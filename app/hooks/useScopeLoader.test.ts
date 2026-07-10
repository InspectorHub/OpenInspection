import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScopeLoader, type ScopeLoadData } from "~/hooks/useScopeLoader";
import type { ResultMap } from "~/hooks/useInspection";

// Drive the hook the way the editor does: a single shared fetcher, so re-submits
// abort the prior in-flight load. `fetcherData` is the prop that changes when a
// response lands; `submit`/`onSlice` are stable spies.
function setup(initial?: ScopeLoadData) {
	const submit = vi.fn<(scope: string) => void>();
	const onSlice = vi.fn<(slice: ResultMap) => void>();
	const view = renderHook(
		({ fetcherData }: { fetcherData: ScopeLoadData | undefined }) =>
			useScopeLoader({ collabSynced: false, fetcherData, submit, onSlice }),
		{ initialProps: { fetcherData: initial } },
	);
	return { view, submit, onSlice };
}

const slice = (scope: string): ResultMap => ({ [`${scope}:s1:i1`]: { rating: "poor" } }) as unknown as ResultMap;

describe("useScopeLoader", () => {
	it("submits a unit scope once, dedupes after a successful merge, skips '_default' and collab-synced", () => {
		const { view, submit, onSlice } = setup();

		act(() => view.result.current("u_a"));
		expect(submit).toHaveBeenCalledWith("u_a");
		expect(submit).toHaveBeenCalledTimes(1);

		// merge lands → u_a is now in the map
		view.rerender({ fetcherData: { ok: true, intent: "load-scope", scope: "u_a", results: slice("u_a") } });
		expect(onSlice).toHaveBeenCalledWith(slice("u_a"));

		// switching back to u_a no longer re-fetches (merged)
		act(() => view.result.current("u_a"));
		expect(submit).toHaveBeenCalledTimes(1);

		// '_default' is always present from first paint → never fetched
		act(() => view.result.current(null));
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("keeps a superseded (aborted) scope re-fetchable — the abort-race fix", () => {
		const { view, submit, onSlice } = setup();

		// Fast A→B switch on the shared fetcher: B's submit aborts A's in-flight load.
		act(() => view.result.current("u_a"));
		act(() => view.result.current("u_b"));
		expect(submit.mock.calls.map((c) => c[0])).toEqual(["u_a", "u_b"]);

		// Only B's response arrives (A's was aborted and never delivers).
		view.rerender({ fetcherData: { ok: true, intent: "load-scope", scope: "u_b", results: slice("u_b") } });
		expect(onSlice).toHaveBeenCalledTimes(1);
		expect(onSlice).toHaveBeenCalledWith(slice("u_b"));

		// u_a was never merged, so switching back MUST re-fetch it (the bug: under
		// optimistic-on-submit dedupe this would no-op and render u_a empty).
		act(() => view.result.current("u_a"));
		expect(submit).toHaveBeenLastCalledWith("u_a");
		expect(submit).toHaveBeenCalledTimes(3);
	});

	it("ignores a stale response for a scope other than the last submit", () => {
		const { view, onSlice } = setup();

		act(() => view.result.current("u_a"));
		act(() => view.result.current("u_b")); // in-flight is now u_b

		// A late slice for the superseded u_a must not merge.
		view.rerender({ fetcherData: { ok: true, intent: "load-scope", scope: "u_a", results: slice("u_a") } });
		expect(onSlice).not.toHaveBeenCalled();
	});

	it("does not mark a scope fetched on a failed load, so it retries", () => {
		const { view, submit, onSlice } = setup();

		act(() => view.result.current("u_a"));
		view.rerender({ fetcherData: { ok: false, intent: "load-scope", scope: "u_a" } });
		expect(onSlice).not.toHaveBeenCalled();

		// failed → still re-fetchable
		act(() => view.result.current("u_a"));
		expect(submit).toHaveBeenCalledTimes(2);
	});
});
