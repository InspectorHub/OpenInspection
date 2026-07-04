// Renders MediaViewerToolbar under happy-dom via react-dom/client (no RTL dep in
// this repo). JSX avoided so the file stays a .spec.ts and matches the vitest
// glob; assertions query buttons by accessible name (text content).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaViewerToolbar } from '~/components/media-studio/MediaViewer';

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

function rerender(node: React.ReactElement) {
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

function buttonByName(re: RegExp): HTMLButtonElement | null {
  const buttons = Array.from(container!.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((b) => re.test(b.textContent ?? '')) ?? null;
}

describe('MediaViewerToolbar', () => {
  it('shows Revert only when the photo is edited', () => {
    const noop = vi.fn();
    mount(createElement(MediaViewerToolbar, { kind: 'photo', edited: false, on: noop }));
    expect(buttonByName(/revert/i)).toBeNull();
    rerender(createElement(MediaViewerToolbar, { kind: 'photo', edited: true, on: noop }));
    expect(buttonByName(/revert/i)).not.toBeNull();
  });
  it('always offers crop, annotate, set cover, delete for a photo', () => {
    mount(createElement(MediaViewerToolbar, { kind: 'photo', edited: false, on: vi.fn() }));
    ['crop', 'annotate', 'set cover', 'delete'].forEach((n) =>
      expect(buttonByName(new RegExp(n, 'i'))).not.toBeNull());
  });

  it('renders the LOCKED minimal video toolbar (poster · cover · caption · delete) — no crop/annotate/rotate/revert', () => {
    mount(createElement(MediaViewerToolbar, { kind: 'video', edited: true, on: vi.fn() }));
    // present: exactly the four video actions
    ['poster frame', 'set cover', 'caption', 'delete'].forEach((n) =>
      expect(buttonByName(new RegExp(n, 'i'))).not.toBeNull());
    // absent: photo-only editing actions are NOT offered for video
    ['crop', 'annotate', 'rotate', 'revert'].forEach((n) =>
      expect(buttonByName(new RegExp(`^${n}$`, 'i'))).toBeNull());
    // exactly four buttons in the video toolbar
    const buttons = Array.from(container!.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);
  });
});
