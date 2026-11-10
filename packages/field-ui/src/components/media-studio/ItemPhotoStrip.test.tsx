// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ItemPhotoStrip } from './ItemPhotoStrip';

afterEach(cleanup);

function strip(over: Partial<React.ComponentProps<typeof ItemPhotoStrip>> = {}) {
  const onAddPhoto = vi.fn();
  render(
    <ItemPhotoStrip
      inspectionId="insp-1"
      itemId="item-1"
      photos={[]}
      coverKey={null}
      photoUrl={(key) => `/photo/${key}`}
      onAddPhoto={onAddPhoto}
      onOpen={() => {}}
      {...over}
    />,
  );
  return { onAddPhoto };
}

describe('ItemPhotoStrip add tile', () => {
  it('lets the person add the next photo while earlier ones are still uploading (the upload queue takes more batches; blocking the tile stopped an inspector from carrying on)', () => {
    const { onAddPhoto } = strip({ photoUploading: true });
    const add = screen.getByTestId('photo-add');
    expect(add.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(add);
    expect(onAddPhoto).toHaveBeenCalledTimes(1);
  });

  it('still tells the person an upload is running, without taking the plus away', () => {
    strip({ photoUploading: true });
    const add = screen.getByTestId('photo-add');
    expect(add.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('photo-add-uploading')).toBeTruthy();
    expect(add.querySelector('path[d="M12 4v16m8-8H4"]')).not.toBeNull();
  });

  it('control: when nothing is uploading the tile is a plain plus with no busy mark', () => {
    const { onAddPhoto } = strip({ photoUploading: false });
    const add = screen.getByTestId('photo-add');
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(screen.queryByTestId('photo-add-uploading')).toBeNull();
    fireEvent.click(add);
    expect(onAddPhoto).toHaveBeenCalledTimes(1);
  });
});

describe('ItemPhotoStrip R2 video tile', () => {
  const r2Video = { key: '', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'pool-9', durationSec: 3 };

  it('draws a video tile for an R2 clip, with the poster the host resolves from the media id', () => {
    const seen: Array<{ provider?: string; mediaId?: string; streamUid?: string }> = [];
    strip({
      photos: [{ key: 'a.jpg' }, r2Video],
      videoPosterUrl: (v) => {
        seen.push(v);
        return v.mediaId ? `/media/video/r2-object/${v.mediaId}/poster` : null;
      },
    });
    expect(screen.getByTestId('video-play-1')).toBeTruthy();
    expect(screen.getByTestId('video-dur-1').textContent).toBe('0:03');
    const img = screen.getByTestId('thumb-1').querySelector('img');
    expect(img?.getAttribute('src')).toBe('/media/video/r2-object/pool-9/poster');
    expect(seen[0]).toMatchObject({ provider: 'r2', mediaId: 'pool-9' });
    // control: the photo gets no play glyph
    expect(screen.queryByTestId('video-play-0')).toBeNull();
  });

  it('shows the neutral placeholder when the host has no address for the poster (native)', () => {
    strip({ photos: [r2Video], videoPosterUrl: () => null });
    expect(screen.getByTestId('video-placeholder-0')).toBeTruthy();
    expect(screen.getByTestId('video-play-0')).toBeTruthy();
  });
});

describe('ItemPhotoStrip select mode with videos', () => {
  const photos = [
    { key: 'a.jpg' },
    { key: '', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'pool-9' },
  ];
  const bulk = () => ({ selectable: true, onBulkDetach: vi.fn(), photos, videoPosterUrl: () => null });

  it('dims a video tile and cannot select it; says why in one line; a photo still selects', () => {
    const props = bulk();
    strip(props);
    fireEvent.click(screen.getByText('Select'));
    expect(screen.getByTestId('video-bulk-hint').textContent).toMatch(/video/i);
    const tile = screen.getByTestId('thumb-1');
    expect(tile.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('check-1')).toBeNull();
    fireEvent.click(tile);
    fireEvent.click(screen.getByTestId('thumb-0'));
    expect(screen.getByTestId('check-0')).toBeTruthy();
    fireEvent.click(screen.getByText('Delete 1'));
    expect(props.onBulkDetach).toHaveBeenCalledWith([0]);
  });

  it('control: with no video there is no hint and nothing is disabled', () => {
    strip({ selectable: true, onBulkDetach: vi.fn(), photos: [{ key: 'a.jpg' }] });
    fireEvent.click(screen.getByText('Select'));
    expect(screen.queryByTestId('video-bulk-hint')).toBeNull();
    expect(screen.getByTestId('thumb-0').getAttribute('aria-disabled')).toBeNull();
  });

  it('outside select mode a video tile still opens', () => {
    const onOpen = vi.fn();
    strip({ ...bulk(), onOpen });
    fireEvent.click(screen.getByTestId('thumb-1'));
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
