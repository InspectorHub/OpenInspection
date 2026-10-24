/**
 * Media Studio — annotation model. Coords are NATURAL-IMAGE PIXELS (resolution-
 * stable). `annotationsJson` stored server-side is the JSON of this array.
 */
export interface Point { x: number; y: number }
export type Annotation =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'arrow'; x: number; y: number; x2: number; y2: number }
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'freehand'; x: number; y: number; points: Point[] }
  | { kind: 'measure'; x: number; y: number; x2: number; y2: number; unit: string };
export const ANNOTATION_COLOR = '#ef4444';

/** P6 — measure-tool calibration persisted alongside the annotations. */
export interface Calibration { pxPerUnit: number; calibUnit: string }

export function serializeAnnotations(anns: Annotation[]): string { return JSON.stringify(anns); }
export function deserializeAnnotations(json: string | null | undefined): Annotation[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    if (Array.isArray(p)) return p as Annotation[];
    // New envelope { annotations, calibration } — return its annotations.
    if (p && Array.isArray(p.annotations)) return p.annotations as Annotation[];
    return [];
  } catch { return []; }
}

/** P6 — serialize annotations TOGETHER WITH measure calibration. */
export function serializeMeasureDoc(anns: Annotation[], calibration: Calibration | null): string {
  return JSON.stringify({ annotations: anns, calibration });
}
export function deserializeMeasureDoc(json: string | null | undefined): { annotations: Annotation[]; calibration: Calibration | null } {
  if (!json) return { annotations: [], calibration: null };
  try {
    const p = JSON.parse(json);
    if (Array.isArray(p)) return { annotations: p as Annotation[], calibration: null };
    if (p && Array.isArray(p.annotations)) {
      const c = p.calibration;
      const calibration = (c && typeof c.pxPerUnit === 'number' && typeof c.calibUnit === 'string')
        ? { pxPerUnit: c.pxPerUnit, calibUnit: c.calibUnit } : null;
      return { annotations: p.annotations as Annotation[], calibration };
    }
    return { annotations: [], calibration: null };
  } catch { return { annotations: [], calibration: null }; }
}
