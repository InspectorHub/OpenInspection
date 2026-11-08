import { describe, expect, it } from 'vitest';
import { itemMediaCaption } from './item-media-caption';

describe('itemMediaCaption', () => {
  it('counts photos only when there are no videos', () => {
    expect(itemMediaCaption([{ key: 'a' }])).toBe('1 photo');
    expect(itemMediaCaption([{ key: 'a' }, { key: 'b' }])).toBe('2 photos');
  });

  it('counts photos and videos separately when there are both', () => {
    const video = { key: '', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'p1' };
    expect(itemMediaCaption([{ key: 'a' }, video])).toBe('1 photo, 1 video');
    expect(itemMediaCaption([{ key: 'a' }, { key: 'b' }, video, { ...video, mediaId: 'p2' }])).toBe('2 photos, 2 videos');
  });

  it('says only videos when there is no photo', () => {
    const video = { key: '', mediaType: 'video' as const, streamUid: 'u1' };
    expect(itemMediaCaption([video])).toBe('1 video');
  });

  it('is null for an empty list so the caller shows its empty copy', () => {
    expect(itemMediaCaption([])).toBeNull();
  });
});
