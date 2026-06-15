import { describe, it, expect } from 'vitest';
import { serializeAnnotations, deserializeAnnotations, type Annotation } from '~/components/image-studio/annotations';
describe('annotations serialization', () => {
  const anns: Annotation[] = [
    { kind: 'circle', x: 100, y: 120, r: 40 },
    { kind: 'arrow', x: 10, y: 10, x2: 90, y2: 90 },
    { kind: 'label', x: 50, y: 50, text: 'Crack' },
    { kind: 'freehand', x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 5, y: 6 }] },
  ];
  it('round-trips through JSON', () => {
    expect(deserializeAnnotations(serializeAnnotations(anns))).toEqual(anns);
  });
  it('deserializes empty/garbage to []', () => {
    expect(deserializeAnnotations('')).toEqual([]);
    expect(deserializeAnnotations('not json')).toEqual([]);
  });
});
