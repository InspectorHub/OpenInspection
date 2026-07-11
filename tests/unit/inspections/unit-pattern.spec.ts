import { describe, it, expect } from 'vitest';
import { expandFloorsStacks, parseUnitCsv } from '../../../server/lib/unit-pattern';

describe('expandFloorsStacks', () => {
  it('expands floors x stacks into floor-prefixed labels', () => {
    expect(expandFloorsStacks({ floors: [1, 2], stacks: 2 })).toEqual([
      { label: '101', floor: '1' },
      { label: '102', floor: '1' },
      { label: '201', floor: '2' },
      { label: '202', floor: '2' },
    ]);
  });

  it('honours startAt and zero-pads to the stack width', () => {
    expect(expandFloorsStacks({ floors: [1], stacks: 12 }).at(0)).toEqual({ label: '101', floor: '1' });
    expect(expandFloorsStacks({ floors: [1], stacks: 12 }).at(-1)).toEqual({ label: '112', floor: '1' });
  });

  it('returns [] for non-positive stacks or empty floors', () => {
    expect(expandFloorsStacks({ floors: [], stacks: 4 })).toEqual([]);
    expect(expandFloorsStacks({ floors: [1], stacks: 0 })).toEqual([]);
  });
});

describe('parseUnitCsv', () => {
  it('parses label[,floor] lines and drops a header + blanks', () => {
    expect(parseUnitCsv('label,floor\n101,1\n\n4B,4\nPH ,')).toEqual([
      { label: '101', floor: '1' },
      { label: '4B', floor: '4' },
      { label: 'PH', floor: null },
    ]);
  });

  it('treats a single column as label-only', () => {
    expect(parseUnitCsv('Lobby\nRetail Bay')).toEqual([
      { label: 'Lobby', floor: null },
      { label: 'Retail Bay', floor: null },
    ]);
  });
});
