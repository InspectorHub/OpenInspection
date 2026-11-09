import { describe, expect, it } from 'vitest';
import { ALL_MEDIA_ACTIONS } from './MediaViewer';
import { viewerHiddenActions } from './viewer-actions';
import type { GalleryPhoto } from '../../shared/inspection-media';

const photo = (over: Partial<GalleryPhoto>): GalleryPhoto => ({ key: 'k', url: '/u', label: '', itemId: 'i1', photoIndex: 0, originalKey: 'k', ...over });

describe('viewerHiddenActions', () => {
  it('hides everything when read-only', () => {
    expect(viewerHiddenActions(photo({}), { readOnly: true, video: true })).toEqual(ALL_MEDIA_ACTIONS);
  });

  // Caption and Rotate have no handler in the editor: pressed, they only closed the viewer. They are not offered.
  it('never offers Rotate or Caption (no handler), and hides the poster action without video support', () => {
    expect(viewerHiddenActions(photo({}), { readOnly: false, video: false })).toEqual(['rotate', 'caption', 'poster']);
    expect(viewerHiddenActions(photo({}), { readOnly: false, video: true })).toEqual(['rotate', 'caption']);
  });

  it('hides Annotate on a photo that exists only in the local pending store (it has no stored image to draw on)', () => {
    const keyless = photo({ key: 'pending-1', originalKey: '', pending: true });
    expect(viewerHiddenActions(keyless, { readOnly: false, video: true })).toEqual(['rotate', 'caption', 'annotate']);
    expect(viewerHiddenActions(keyless, { readOnly: false, video: false })).toEqual(['rotate', 'caption', 'poster', 'annotate']);
  });

  it('keeps Annotate for a pending crop or annotation that still has its base key', () => {
    expect(viewerHiddenActions(photo({ pending: true, originalKey: 'base.jpg' }), { readOnly: false, video: true })).toEqual(['rotate', 'caption']);
  });

  it('has nothing to say about a viewer that is closed', () => {
    expect(viewerHiddenActions(undefined, { readOnly: false, video: true })).toEqual(['rotate', 'caption']);
  });
});
