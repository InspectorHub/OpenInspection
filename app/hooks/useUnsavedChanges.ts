import { useEffect, useCallback, useRef } from "react";
import { useBlocker } from "react-router";

/**
 * What the editor can honestly call "unsaved", given how it actually saves.
 *
 * Kept as a pure function beside the hook rather than inline at the call site,
 * because the defect this replaces was ENTIRELY in the condition and not at all
 * in the hook — and a condition written inline in a 2,600-line route is a
 * condition nobody can test.
 *
 * ── What went wrong before ──────────────────────────────────────────────────
 * A single boolean was set by every Y.Doc write (fifteen call sites) and cleared
 * in exactly one place: an effect watching three fetchers. Y.Doc writes travel
 * over the collab socket and use none of those fetchers, so the effect never
 * re-ran and the flag never came back down — one edit armed the guard for the
 * rest of the session. A photo upload armed it by a different route, because the
 * clearing effect ran first when that fetcher settled and the attach effect ran
 * second in the same commit, writing the photo key to the doc and setting it
 * straight back.
 *
 * ── Why these three inputs ──────────────────────────────────────────────────
 * Once the socket has synced, the document host HAS the edit. There is nothing
 * unsaved to warn about, and warning anyway is worse than silence: it teaches
 * inspectors that the dialog is noise, so it stops working on the day it matters.
 *
 * What is genuinely at risk is an edit made while the connection is NOT synced —
 * which lives only in this tab until it reconnects — and a photo upload still in
 * flight, which is the one write that does not go through the doc and so cannot
 * be replayed from local state.
 *
 * ⚠️ `hasLocalEdits` is still needed and must not be dropped as redundant. Without
 * it, a disconnected editor nobody has touched is indistinguishable from a
 * disconnected editor holding a session of work.
 */
export function unsavedChangesAtRisk(input: {
  /** Any Y.Doc write has happened in this editor session. */
  hasLocalEdits: boolean;
  /** The collab socket has completed a sync round, so the host holds the doc. */
  collabSynced: boolean;
  /** A photo upload request is in flight. */
  uploadInFlight: boolean;
}): boolean {
  return (input.hasLocalEdits && !input.collabSynced) || input.uploadInFlight;
}

export function useUnsavedChanges(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const confirmLeave = useCallback(() => {
    if (blocker.state === "blocked") blocker.proceed();
  }, [blocker]);

  const cancelLeave = useCallback(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);

  return { blocker, confirmLeave, cancelLeave };
}
