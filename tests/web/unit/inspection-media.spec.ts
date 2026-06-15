import { describe, it, expect } from 'vitest';
import { flattenMedia, type MediaApiBody } from '~/lib/inspection-media';
describe('flattenMedia', () => {
  const body: MediaApiBody = { data: {
    attached: [{ key: 'a.jpg', url: '/p/a.jpg', itemLabel: 'Roof' }, { key: 'a.jpg', url: '/p/a.jpg', itemLabel: 'Roof' }],
    pool: [{ key: 'b.jpg', url: '/p/b.jpg' }],
  } };
  it('dedupes by key and labels attached vs pool', () => {
    const out = flattenMedia(body);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ key: 'a.jpg', url: '/p/a.jpg', label: 'Roof' });
    expect(out[1]).toEqual({ key: 'b.jpg', url: '/p/b.jpg', label: 'Unattached' });
  });
  it('tolerates a missing data envelope', () => { expect(flattenMedia(null)).toEqual([]); });
});
