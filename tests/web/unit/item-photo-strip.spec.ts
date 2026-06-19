// Renders ItemPhotoStrip under happy-dom via react-dom/client (no RTL dep in
// this repo). JSX avoided so the file stays a .spec.ts and matches the vitest
// glob; assertions query the DOM directly (data-testid / role / aria-label).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ItemPhotoStrip, type StripPhoto } from '~/components/media-studio/ItemPhotoStrip';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function $(sel: string): HTMLElement | null {
  return container!.querySelector(sel);
}
function $$(sel: string): HTMLElement[] {
  return Array.from(container!.querySelectorAll(sel));
}
function byTestId(id: string): HTMLElement | null {
  return container!.querySelector(`[data-testid="${id}"]`);
}
function byAria(label: string): HTMLElement | null {
  return container!.querySelector(`[aria-label="${label}"]`);
}
function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const photos: StripPhoto[] = [{ key: 'a', annotatedKey: 'a2' }, { key: 'b' }];

describe('ItemPhotoStrip', () => {
  it('renders one thumbnail per photo plus an add tile, and rings the cover', () => {
    mount(
      createElement(ItemPhotoStrip, {
        inspectionId: 'i',
        itemId: 'it',
        photos,
        coverKey: 'a2',
        photoUrl: (k: string) => `/u/${k}`,
        onAddPhoto: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    expect($$('img')).toHaveLength(2);
    expect(byAria('Add photo')).not.toBeNull();
    // displayKey a2 === coverKey → cover ring on thumb-0
    expect(byTestId('thumb-0')!.className).toContain('is-cover');
    expect(byTestId('thumb-1')!.className).not.toContain('is-cover');
  });

  it('calls onOpen with the index when a thumbnail is tapped', () => {
    const onOpen = vi.fn();
    mount(
      createElement(ItemPhotoStrip, {
        inspectionId: 'i',
        itemId: 'it',
        photos,
        coverKey: null,
        photoUrl: (k: string) => `/u/${k}`,
        onAddPhoto: vi.fn(),
        onOpen,
      }),
    );
    click(byTestId('thumb-1'));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('enters select mode and reports chosen indices to bulk detach', () => {
    const onBulkDetach = vi.fn();
    mount(
      createElement(ItemPhotoStrip, {
        selectable: true,
        inspectionId: 'i',
        itemId: 'it',
        photos,
        coverKey: null,
        photoUrl: (k: string) => `/u/${k}`,
        onAddPhoto: vi.fn(),
        onOpen: vi.fn(),
        onBulkDetach,
      }),
    );
    // visible "Select" toggle enters select mode
    const selectBtn = $$('button').find((b) => /select/i.test(b.textContent ?? ''));
    click(selectBtn ?? null);
    // tap the checkbox overlay on thumb-0
    click(byTestId('check-0'));
    // bulk bar "Delete 1"
    const deleteBtn = $$('button').find((b) => /delete/i.test(b.textContent ?? ''));
    click(deleteBtn ?? null);
    expect(onBulkDetach).toHaveBeenCalledWith([0]);
  });

  it('reports chosen indices + target to bulk move', () => {
    const onBulkMove = vi.fn();
    mount(
      createElement(ItemPhotoStrip, {
        selectable: true,
        inspectionId: 'i',
        itemId: 'it',
        photos,
        coverKey: null,
        photoUrl: (k: string) => `/u/${k}`,
        onAddPhoto: vi.fn(),
        onOpen: vi.fn(),
        onBulkMove,
        moveTargets: [{ itemId: 'other', label: 'Garage' }],
      }),
    );
    // enter select mode + check thumb-1
    const selectBtn = $$('button').find((b) => /select/i.test(b.textContent ?? ''));
    click(selectBtn ?? null);
    click(byTestId('check-1'));
    // change the "Move to" combobox → fires onBulkMove([1], { itemId, sectionId })
    const combo = container!.querySelector('select') as HTMLSelectElement;
    act(() => {
      combo.value = 'other';
      combo.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onBulkMove).toHaveBeenCalledWith([1], { itemId: 'other', sectionId: undefined });
  });

  it('Plan 7 — video entries render a poster thumb + play-glyph + m:ss duration badge', () => {
    const withVideo: StripPhoto[] = [
      { key: 'a' },
      { key: '', mediaType: 'video', streamUid: 'uid9', posterPct: 0.5, durationSec: 75 },
    ];
    mount(
      createElement(ItemPhotoStrip, {
        inspectionId: 'i',
        itemId: 'it',
        photos: withVideo,
        coverKey: null,
        photoUrl: (k: string) => `/u/${k}`,
        onAddPhoto: vi.fn(),
        onOpen: vi.fn(),
        videoPosterUrl: (uid: string) => `https://sub.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=0s`,
      }),
    );
    // thumb-1 is the video: play-glyph + duration badge present
    expect(byTestId('video-play-1')).not.toBeNull();
    expect(byTestId('video-dur-1')!.textContent).toBe('1:15');
    // poster img uses the resolved Stream thumbnail URL
    const vidImg = byTestId('thumb-1')!.querySelector('img') as HTMLImageElement;
    expect(vidImg.src).toContain('cloudflarestream.com/uid9/thumbnails');
    // the photo entry (thumb-0) has NO play-glyph
    expect(byTestId('video-play-0')).toBeNull();
  });

  it('Plan 7 — video entry falls closed to a neutral placeholder when no poster URL is resolvable', () => {
    const withVideo: StripPhoto[] = [
      { key: '', mediaType: 'video', streamUid: 'uid9', durationSec: 10 },
    ];
    mount(
      createElement(ItemPhotoStrip, {
        inspectionId: 'i',
        itemId: 'it',
        photos: withVideo,
        coverKey: null,
        photoUrl: (k: string) => `/u/${k}`,
        onAddPhoto: vi.fn(),
        onOpen: vi.fn(),
        videoPosterUrl: () => null, // subdomain unavailable
      }),
    );
    expect(byTestId('video-placeholder-0')).not.toBeNull();
    expect(byTestId('video-play-0')).not.toBeNull();
  });
});
