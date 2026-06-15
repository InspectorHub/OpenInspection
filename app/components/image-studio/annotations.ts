/**
 * Image Studio — annotation model. Coords are NATURAL-IMAGE PIXELS (resolution-
 * stable). `annotationsJson` stored server-side is the JSON of this array.
 */
export interface Point { x: number; y: number }
export type Annotation =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'arrow'; x: number; y: number; x2: number; y2: number }
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'freehand'; x: number; y: number; points: Point[] };
export const ANNOTATION_COLOR = '#ef4444';
export function serializeAnnotations(anns: Annotation[]): string { return JSON.stringify(anns); }
export function deserializeAnnotations(json: string | null | undefined): Annotation[] {
  if (!json) return [];
  try { const p = JSON.parse(json); return Array.isArray(p) ? (p as Annotation[]) : []; } catch { return []; }
}
