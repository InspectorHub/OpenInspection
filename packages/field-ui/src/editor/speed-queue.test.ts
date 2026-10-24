import { describe, expect, it } from 'vitest';
import { countUnratedItems } from './speed-queue';

const SECTIONS = [
  { id: 's1', items: [{ id: 'a' }, { id: 'b' }] },
  { id: 's2', items: [{ id: 'c' }] },
];

describe('countUnratedItems', () => {
  it('counts the items whose result has no rating, across sections', () => {
    const results: Record<string, Record<string, unknown>> = { 's1:a': { rating: 'ok' }, 's2:c': { rating: '' } };
    expect(countUnratedItems(SECTIONS, (id, sid) => results[`${sid}:${id}`])).toBe(2);
  });

  it('CONTROL - everything rated counts zero, nothing rated counts all', () => {
    expect(countUnratedItems(SECTIONS, () => ({ rating: 'ok' }))).toBe(0);
    expect(countUnratedItems(SECTIONS, () => undefined)).toBe(3);
  });

  it('asks for each item under its own section', () => {
    const asked: string[] = [];
    countUnratedItems(SECTIONS, (id, sid) => { asked.push(`${sid}:${id}`); return undefined; });
    expect(asked).toEqual(['s1:a', 's1:b', 's2:c']);
  });
});
