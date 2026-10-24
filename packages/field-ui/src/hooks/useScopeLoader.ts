import { useCallback, useEffect, useRef } from "react";
import { useFieldDataSource } from "../context";
import type { ResultMap } from "../data-source-types";

interface UseScopeLoaderParams {
	/** The inspection whose scope slices are loaded. */
	inspectionId: string;
	/** When the collab doc has synced, `readResultMap` already holds every scope's
	 *  findings (the DO hydrated the full D1 blob), so a switch needs no fetch. */
	collabSynced: boolean;
	/** Merge a fetched scope slice into the editor's results map. */
	onSlice: (slice: ResultMap) => void;
}

/**
 * Commercial PCA Phase U — fetch-if-missing tracking for the per-unit lazy scope
 * switch. A slice is read with `FieldDataSource.load(inspectionId, scope)`: a read, not
 * a command, so the write guard of `useFieldCommand` (which DROPS an overlapping call)
 * must not sit in front of it. Two loads may be in flight at once, so a fast A→B switch
 * is handled here, as it was when the route shared one fetcher that aborted the
 * earlier submit and only the last load could still deliver.
 *
 * The correctness hinge is keeping two things separate:
 *   - `mergedRef`   — scopes whose slice is already in the results map. These are
 *                     deduped permanently ('_default' is present from first paint).
 *   - `inFlightRef` — the scope of the LAST request (the only load whose answer may
 *                     still land).
 *
 * A scope is marked "fetched" (added to `mergedRef`) ONLY on a successful merge —
 * never optimistically on request. If we deduped on request, a superseded scope would
 * be stuck: flagged fetched yet never merged, rendering empty until a reload.
 * Merged-only marking keeps a superseded or failed scope re-fetchable on the next
 * switch, and the `inFlightRef` guard drops any stale (superseded) answer.
 *
 * Returns `requestScope(unitId)` for the switcher/manager to call on select.
 */
export function useScopeLoader({ inspectionId, collabSynced, onSlice }: UseScopeLoaderParams) {
	const dataSource = useFieldDataSource();
	const mergedRef = useRef<Set<string>>(new Set(["_default"]));
	const inFlightRef = useRef<string | null>(null);
	// Counts requests, so a rejection can tell whether it belongs to the LAST request.
	const seqRef = useRef(0);
	const mountedRef = useRef(true);
	// The latest merge callback, read when an answer lands (not when it was requested).
	const onSliceRef = useRef(onSlice);
	onSliceRef.current = onSlice;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	return useCallback(
		(unitId: string | null) => {
			const scope = unitId ?? "_default";
			if (scope === "_default") return; // always loaded (first-paint common slice)
			if (collabSynced) return; // full map already present
			if (mergedRef.current.has(scope)) return; // already in the results map
			inFlightRef.current = scope; // supersedes any earlier in-flight load
			const seq = ++seqRef.current;
			void dataSource.load(inspectionId, scope).then(
				(data) => {
					// Only the scope of the last request may land: a superseded load must not
					// merge or mark itself fetched, so it stays re-fetchable on a later switch.
					if (inFlightRef.current !== scope) return;
					inFlightRef.current = null;
					if (!mountedRef.current) return;
					mergedRef.current.add(scope); // mark fetched ONLY on success
					onSliceRef.current(data.results);
				},
				() => {
					// A failed load merges nothing and leaves the scope re-fetchable. It may only clear the
					// marker when it is still the LAST request: an earlier request for the same scope that fails
					// late (A, B, A with the first A rejecting) must not drop the newer A's answer.
					if (seqRef.current === seq && inFlightRef.current === scope) inFlightRef.current = null;
				},
			);
		},
		[collabSynced, dataSource, inspectionId],
	);
}
