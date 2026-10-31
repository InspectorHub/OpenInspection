import type { ReactNode } from 'react';

/**
 * Host-supplied UI, injected through `FieldDataSourceProvider` rather than read
 * from the data source: the package renders the entry point, the host owns the
 * implementation.
 */
export interface FieldHostSlots {
  /** The theme switch shown in the header (the web host passes `ThemeSegmentControl`). Absent hides it. */
  renderThemeControl?: (props: { className?: string }) => ReactNode;
  /**
   * PDF export, kept in the host (it needs the host's download machinery).
   * `run` starts the export for the inspection; the rest is what the header
   * reads off `usePdfExport`. Absent hides the PDF entry points.
   */
  pdf?: {
    run(inspectionId: string): void;
    busy: boolean;
    /** The last failure's sentence, or null. */
    error: string | null;
    /** Button text: the host's `pdfActionLabel`, which swaps in "Generating" / "Retry in N s". */
    actionLabel(defaultLabel: string): string;
  };
  /**
   * The human check that gates an outbound send (publish). Resolves `true` when the person may go on (the
   * check passed, or none is due) and `false` when they cancelled it. Read it through `useFieldEnsureHuman`,
   * which hands back a stable function.
   *
   * FAIL-CLOSED: a host that provides neither this nor `humanCheck: 'not-required'` gets a check that refuses
   * every send and tells the person why. A forgotten slot must never turn the gate off; the client check is the
   * only gate on publishing, so skipping it has to be a decision the host writes down.
   */
  ensureHuman?: () => Promise<boolean>;
  /**
   * The explicit opt-out of the human check, for a host that has none by design (a native shell with its own
   * signed-in session). Only this exact value lets sends through without `ensureHuman`; it is not a default.
   */
  humanCheck?: 'not-required';
  /**
   * The unsaved-changes guard: a component the editor mounts once, which watches `atRisk` and, while it is
   * true, stops the person leaving the page without asking. The host owns the mechanism (a router blocker, the
   * browser's close prompt) and renders its own confirmation. Absent means leaving is never intercepted.
   */
  renderUnsavedGuard?: (props: { atRisk: boolean }) => ReactNode;
  /**
   * A status element of the host's own (an offline indicator, say), shown beside the save state in the editor's header
   * (desktop) and app bar (phone and tablet). It adds to the save state and never replaces it. Absent, or returning
   * nothing, leaves the header as it was. It must be pure: it may be called more than once per render. The host owns the element's semantics (role, live region) and should keep it
   * small: the phone app bar shares one row with the title and the More button.
   */
  renderStatus?: () => ReactNode;
  /** Told which layout band the browser really shows (after mount, and on change); a host that remembers it returns it as `EditorData.initialLayout`. */
  onLayoutObserved?: (layout: 'phone' | 'tablet' | 'desktop') => void;
}
