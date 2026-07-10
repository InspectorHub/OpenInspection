import { useCallback, useEffect, useRef } from "react";
import type { ResultMap } from "./useInspection";

export interface ScopeLoadData {
	ok: boolean;
	intent?: string;
	scope?: string;
	results?: ResultMap;
}

interface UseScopeLoaderParams {
	/** When the collab doc has synced, `readResultMap` already holds every scope's
	 *  findings (the DO hydrated the full D1 blob), so a switch needs no fetch. */
	collabSynced: boolean;
	/** The latest `load-scope` response from the shared scope fetcher. */
	fetcherData: ScopeLoadData | undefined;
	/** Fire the `load-scope` submission for a unit scope (non-'_default'). */
	submit: (scope: string) => void;
	/** Merge a fetched scope slice into the editor's results map. */
	onSlice: (slice: ResultMap) => void;
}

/**
 * Commercial PCA Phase U — fetch-if-missing tracking for the per-unit lazy scope
 * switch. The editor drives all scope loads through ONE shared `useFetcher`, and
 * `useFetcher` ABORTS an in-flight submit when the same fetcher re-submits (a known
 * repo footgun). So a fast A→B switch aborts A's load and A's response never
 * arrives.
 *
 * The correctness hinge is keeping two things separate:
 *   - `mergedRef`   — scopes whose slice is already in the results map. These are
 *                     deduped permanently ('_default' is present from first paint).
 *   - `inFlightRef` — the scope of the LAST submit (the only load the shared
 *                     fetcher can still deliver).
 *
 * A scope is marked "fetched" (added to `mergedRef`) ONLY on a successful merge —
 * never optimistically on submit. If we deduped on submit, a superseded/aborted
 * scope would be stuck: flagged fetched yet never merged, rendering empty until a
 * reload. Merged-only marking keeps an aborted or failed scope re-fetchable on the
 * next switch, and the `inFlightRef` guard drops any stale (superseded) response.
 *
 * Returns `requestScope(unitId)` for the switcher/manager to call on select.
 */
export function useScopeLoader({ collabSynced, fetcherData, submit, onSlice }: UseScopeLoaderParams) {
	const mergedRef = useRef<Set<string>>(new Set(["_default"]));
	const inFlightRef = useRef<string | null>(null);

	const requestScope = useCallback(
		(unitId: string | null) => {
			const scope = unitId ?? "_default";
			if (scope === "_default") return; // always loaded (first-paint common slice)
			if (collabSynced) return; // full map already present
			if (mergedRef.current.has(scope)) return; // already in the results map
			inFlightRef.current = scope; // supersedes any earlier in-flight load
			submit(scope);
		},
		[collabSynced, submit],
	);

	// Merge a fetched scope slice (non-collab / pre-sync path). Only the scope of
	// the last submit may land — a superseded (aborted) load must not merge or mark
	// itself fetched, so it stays re-fetchable on a later switch.
	useEffect(() => {
		const d = fetcherData;
		if (!d || d.intent !== "load-scope") return;
		if (d.scope && d.scope !== inFlightRef.current) return; // superseded — ignore
		inFlightRef.current = null;
		if (d.ok && d.results && d.scope) {
			mergedRef.current.add(d.scope); // mark fetched ONLY on success
			onSlice(d.results);
		}
	}, [fetcherData, onSlice]);

	return requestScope;
}
