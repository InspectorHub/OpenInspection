// Renders ItemPhotoStrip under happy-dom via react-dom/client (no RTL dep in
// this repo). JSX avoided so the file stays a .spec.ts and matches the vitest
// glob; assertions query the DOM directly (data-testid / role / aria-label).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ItemPhotoStrip, type StripPhoto } from '~/components/image-studio/ItemPhotoStrip';

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
});
