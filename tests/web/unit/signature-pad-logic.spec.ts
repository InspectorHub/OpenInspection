import { describe, it, expect } from 'vitest';
import {
  strokeWidth,
  signatureReducer,
  initialSignatureState,
  type SignatureState,
  type Stroke,
} from '~/components/media-studio/signaturePad.logic';

const dot = (pen: boolean): Stroke => ({ pen, pts: [{ x: 1, y: 1, p: 0.5 }] });

describe('strokeWidth', () => {
  it('is a constant 2.2px for mouse/touch (pen=false), pressure ignored', () => {
    expect(strokeWidth(false, 0)).toBe(2.2);
    expect(strokeWidth(false, 1)).toBe(2.2);
  });
  it('maps pen pressure 0..1 to 1.1..3.6px', () => {
    expect(strokeWidth(true, 0)).toBeCloseTo(1.1, 5);
    expect(strokeWidth(true, 1)).toBeCloseTo(3.6, 5);
    expect(strokeWidth(true, 0.5)).toBeCloseTo(2.35, 5);
  });
});

describe('signatureReducer', () => {
  it('starts empty and not dirty', () => {
    expect(initialSignatureState).toEqual({ strokes: [], redo: [] });
  });
  it('commit pushes a stroke and clears redo', () => {
    let s: SignatureState = { strokes: [], redo: [dot(true)] };
    s = signatureReducer(s, { type: 'commit', stroke: dot(false) });
    expect(s.strokes).toHaveLength(1);
    expect(s.redo).toEqual([]); // a new stroke invalidates redo
  });
  it('undo moves the last stroke onto the redo stack', () => {
    let s: SignatureState = { strokes: [dot(false), dot(true)], redo: [] };
    s = signatureReducer(s, { type: 'undo' });
    expect(s.strokes).toHaveLength(1);
    expect(s.redo).toHaveLength(1);
  });
  it('undo on an empty stack is a no-op', () => {
    const s = signatureReducer(initialSignatureState, { type: 'undo' });
    expect(s).toEqual(initialSignatureState);
  });
  it('redo pops redo back onto strokes', () => {
    let s: SignatureState = { strokes: [], redo: [dot(true)] };
    s = signatureReducer(s, { type: 'redo' });
    expect(s.strokes).toHaveLength(1);
    expect(s.redo).toEqual([]);
  });
  it('undo then redo round-trips to the original strokes', () => {
    const start: SignatureState = { strokes: [dot(false), dot(true)], redo: [] };
    const out = signatureReducer(signatureReducer(start, { type: 'undo' }), { type: 'redo' });
    expect(out.strokes).toEqual(start.strokes);
  });
  it('clear empties both stacks', () => {
    const s = signatureReducer({ strokes: [dot(false)], redo: [dot(true)] }, { type: 'clear' });
    expect(s).toEqual(initialSignatureState);
  });
});
