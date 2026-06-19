import { describe, it, expect } from 'vitest';
import {
  serializeAnnotations, deserializeAnnotations,
  serializeMeasureDoc, deserializeMeasureDoc,
  type Annotation,
} from '~/components/media-studio/annotations';

describe('measure annotation variant', () => {
  it('round-trips a measure shape (two points + unit)', () => {
    const anns: Annotation[] = [
      { kind: 'measure', x: 10, y: 10, x2: 110, y2: 10, unit: 'in' },
    ];
    expect(deserializeAnnotations(serializeAnnotations(anns))).toEqual(anns);
  });
});

describe('measure calibration persistence', () => {
  it('serializes annotations + calibration (pxPerUnit/calibUnit) and round-trips both', () => {
    const anns: Annotation[] = [{ kind: 'measure', x: 0, y: 0, x2: 50, y2: 0, unit: 'cm' }];
    const json = serializeMeasureDoc(anns, { pxPerUnit: 12.5, calibUnit: 'cm' });
    const out = deserializeMeasureDoc(json);
    expect(out.annotations).toEqual(anns);
    expect(out.calibration).toEqual({ pxPerUnit: 12.5, calibUnit: 'cm' });
  });
  it('a plain annotations array (no calibration envelope) deserializes with null calibration', () => {
    const json = serializeAnnotations([{ kind: 'circle', x: 1, y: 2, r: 3 }]);
    const out = deserializeMeasureDoc(json);
    expect(out.annotations).toEqual([{ kind: 'circle', x: 1, y: 2, r: 3 }]);
    expect(out.calibration).toBeNull();
  });
});
