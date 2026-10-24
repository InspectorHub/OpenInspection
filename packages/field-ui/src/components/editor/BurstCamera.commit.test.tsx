// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { m } from '../../i18n';
import { BurstCamera } from './BurstCamera';

const realFetch = globalThis.fetch;
/** Settles the frame blob reads one at a time, so the test decides when the first commit is still in flight. */
let releaseFrames: Array<() => void> = [];

beforeEach(() => {
  releaseFrames = [];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  globalThis.fetch = vi.fn(
    () =>
      new Promise((resolve) => {
        releaseFrames.push(() => resolve({ blob: async () => new Blob(['frame'], { type: 'image/jpeg' }) } as Response));
      }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

async function openWithOneFrame(onCommit: (blobs: Blob[]) => void, onClose = vi.fn()) {
  render(<BurstCamera open onClose={onClose} onCommit={onCommit} />);
  await act(async () => { await Promise.resolve(); });
  const shutter = screen.getByTestId('burst-shutter');
  fireEvent.mouseDown(shutter);
  fireEvent.mouseUp(shutter);
  return screen.getByTestId('burst-done');
}

describe('BurstCamera Done', () => {
  it('commits the frames ONCE for two presses of Done in one frame, and shows it is working', async () => {
    const onCommit = vi.fn();
    const done = await openWithOneFrame(onCommit);
    act(() => {
      done.click();
      done.click();
    });
    expect(done.textContent).toContain(m.editor_burst_uploading());
    expect(releaseFrames).toHaveLength(1);
    await act(async () => { releaseFrames.forEach((r) => r()); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('CONTROL - a press after the first commit has settled commits again', async () => {
    const onCommit = vi.fn();
    const done = await openWithOneFrame(onCommit);
    act(() => done.click());
    await act(async () => { releaseFrames.forEach((r) => r()); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(done.textContent).toContain(m.common_done());
    act(() => done.click());
    await act(async () => { releaseFrames.forEach((r) => r()); });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
