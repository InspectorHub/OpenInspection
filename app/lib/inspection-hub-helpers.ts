/* ------------------------------------------------------------------ */
/*  Inspection-hub shared types + pure helpers                        */
/* ------------------------------------------------------------------ */

/**
 * #119 Task 6 — a baseline report item the inspector can carry forward into a
 * re-inspection. `open` pre-checks the still-open flagged set in the modal.
 */
export interface ReinspectCandidate {
  itemId: string;
  label: string;
  originalNotes: string | null;
  open: boolean;
}
