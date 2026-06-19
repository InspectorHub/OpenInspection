/**
 * Pure logic for the signature pad (shared Image/Media Studio canvas sub-component).
 *
 * Kept DOM-free so it is unit-testable in tests/web/unit without a real Canvas /
 * PointerEvent. The component (SignaturePad.tsx) owns all the imperative canvas work
 * and delegates the stroke-width formula + the undo/redo/clear transitions to here.
 */

/** One sampled point along a stroke. `p` is pointer pressure (0..1; 0.5 fallback). */
export interface StrokePoint {
  x: number;
  y: number;
  p: number;
}

/** A committed pen stroke. `pen` true => pressure drives width (pointerType === 'pen'). */
export interface Stroke {
  pen: boolean;
  pts: StrokePoint[];
}

export interface SignatureState {
  /** committed strokes, oldest first */
  strokes: Stroke[];
  /** undone strokes available for redo, most-recently-undone last */
  redo: Stroke[];
}

export type SignatureAction =
  | { type: 'commit'; stroke: Stroke }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' };

export const initialSignatureState: SignatureState = { strokes: [], redo: [] };

/**
 * Per-segment stroke width.
 * - pen (stylus): pressure 0..1 → 1.1..3.6px (natural pen feel)
 * - mouse / touch: a flat 2.2px (no usable pressure signal)
 */
export function strokeWidth(pen: boolean, pressure: number): number {
  return pen ? 1.1 + pressure * 2.5 : 2.2;
}

/** Per-stroke undo/redo/clear. A new stroke (`commit`) always invalidates redo. */
export function signatureReducer(state: SignatureState, action: SignatureAction): SignatureState {
  switch (action.type) {
    case 'commit':
      return { strokes: [...state.strokes, action.stroke], redo: [] };
    case 'undo': {
      if (state.strokes.length === 0) return state;
      const next = state.strokes.slice(0, -1);
      const undone = state.strokes[state.strokes.length - 1];
      return { strokes: next, redo: [...state.redo, undone] };
    }
    case 'redo': {
      if (state.redo.length === 0) return state;
      const restored = state.redo[state.redo.length - 1];
      return { strokes: [...state.strokes, restored], redo: state.redo.slice(0, -1) };
    }
    case 'clear':
      return initialSignatureState;
    default:
      return state;
  }
}
