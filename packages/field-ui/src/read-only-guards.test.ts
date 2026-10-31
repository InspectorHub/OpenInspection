import { describe, it, expect, vi } from 'vitest';
import type { KeyboardHandlers } from './hooks/useKeyboard';
import { guardPhotoOps, readOnlyKeyboard } from './read-only-guards';

function handlers() {
  const spies = {
    onRate: vi.fn(), onClearRating: vi.fn(), onNARating: vi.fn(), onNextItem: vi.fn(), onPrevItem: vi.fn(), onToggleSpeed: vi.fn(),
    onSpeedRate: vi.fn(), onPhoto: vi.fn(), onSave: vi.fn(), onPublish: vi.fn(), onCloneLast: vi.fn(), onToggleCheatsheet: vi.fn(),
    onGotoSection: vi.fn(), onOpenSectionPicker: vi.fn(), onOpenTagPicker: vi.fn(), onToggleFullscreen: vi.fn(), onExitFullscreen: vi.fn(),
    onLibrarySelect: vi.fn(), onOpenLibrary: vi.fn(), onOpenSnippets: vi.fn(), onSaveAsSnippet: vi.fn(),
  };
  const h: KeyboardHandlers = { ...spies, speedMode: false, showCommentLibrary: false };
  return { h, spies };
}

describe('readOnlyKeyboard', () => {
  it('turns every writing key into nothing and leaves the rest of the library keys to the browser', () => {
    const { h, spies } = handlers();
    const ro = readOnlyKeyboard(h);
    ro.onRate(3); ro.onClearRating(); ro.onNARating(); ro.onToggleSpeed(); ro.onSpeedRate?.(1); ro.onPhoto(); ro.onSave();
    ro.onPublish(); ro.onCloneLast(); ro.onOpenTagPicker(); ro.onLibrarySelect?.();
    for (const name of ['onRate', 'onClearRating', 'onNARating', 'onToggleSpeed', 'onSpeedRate', 'onPhoto', 'onSave', 'onPublish', 'onCloneLast', 'onOpenTagPicker', 'onLibrarySelect'] as const) {
      expect(spies[name], name).not.toHaveBeenCalled();
    }
    expect([ro.onOpenLibrary, ro.onOpenSnippets, ro.onSaveAsSnippet]).toEqual([undefined, undefined, undefined]);
  });

  it('CONTROL - moving about, the section picker, fullscreen and the cheat sheet still work', () => {
    const { h, spies } = handlers();
    const ro = readOnlyKeyboard(h);
    ro.onNextItem(); ro.onPrevItem(); ro.onToggleCheatsheet(); ro.onGotoSection(1); ro.onOpenSectionPicker(); ro.onToggleFullscreen(); ro.onExitFullscreen();
    for (const name of ['onNextItem', 'onPrevItem', 'onToggleCheatsheet', 'onGotoSection', 'onOpenSectionPicker', 'onToggleFullscreen', 'onExitFullscreen'] as const) {
      expect(spies[name], name).toHaveBeenCalledTimes(1);
    }
  });
});

describe('guardPhotoOps', () => {
  const calls = vi.fn();
  const ops = {
    viewer: { itemId: 'i', index: 0 },
    onOpenPhoto: calls,
    onReorderPhotos: calls, onBulkDetachPhotos: calls, onBulkMovePhotos: calls, onViewerAction: calls, performPhotoCropSave: calls,
    performPhotoAnnotationSave: () => false,
  } as unknown as Parameters<typeof guardPhotoOps>[0];

  it('read-only: the writing handlers do nothing, annotation reports itself handled, opening a photo still works', () => {
    calls.mockClear();
    const g = guardPhotoOps(ops, true);
    g.onReorderPhotos('i', []); g.onBulkDetachPhotos('i', []); g.onViewerAction('crop', {} as never);
    expect(calls).not.toHaveBeenCalled();
    expect(g.performPhotoAnnotationSave({ itemId: 'i', photoIndex: 0 }, new Blob(), '')).toBe(true);
    g.onOpenPhoto('i', 0);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('read-only: a crop or annotation save tells its dialog it may close (once), so the dialog is not left open', () => {
    calls.mockClear();
    const g = guardPhotoOps(ops, true);
    const told: boolean[] = [];
    g.performPhotoCropSave({ itemId: 'i', photoIndex: 0 }, new Blob(), {} as never, (ok) => { told.push(ok); });
    g.performPhotoAnnotationSave({ itemId: 'i', photoIndex: 0 }, new Blob(), '', (ok) => { told.push(ok); });
    expect(told).toEqual([true, true]);
    expect(calls).not.toHaveBeenCalled();
  });

  it('CONTROL - not read-only it is the very same object', () => {
    expect(guardPhotoOps(ops, false)).toBe(ops);
  });
});
