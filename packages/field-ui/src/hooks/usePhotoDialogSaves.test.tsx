// @vitest-environment happy-dom
/**
 * The attempt each Save of the crop dialog and the Photo Studio is held in. What is asserted here is the part that
 * needs exact timing: the frame between the image being admitted and the dialog really being gone, a save that throws
 * before it starts, and a refusal for a dialog nobody is waiting on any more.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldDataSourceProvider } from '../context';
import { m } from '../i18n';
import { MAX_PHOTO_BYTES } from '../shared/photo-limits';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { OnChecked } from './photo-save-guard';
import { usePhotoDialogSaves } from './usePhotoDialogSaves';

afterEach(cleanup);

const target = { itemId: 'i1', photoIndex: 0, sectionId: 's1', sourceUrl: 'x', hasAnnotation: false };
const CROP = { aspect: '1:1', orientation: 'landscape' as const, pixels: { x: 0, y: 0, width: 1, height: 1 } };
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const huge = () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function setup(opts: { annotateChecked?: (input: unknown, onChecked?: OnChecked) => Promise<boolean>; performCrop?: (t: unknown, b: Blob, c: unknown, cb?: OnChecked) => void; performAnnotation?: (...a: unknown[]) => boolean } = {}) {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const performPhotoCropSave = vi.fn(opts.performCrop ?? (() => undefined));
  const performPhotoAnnotationSave = vi.fn(opts.performAnnotation ?? (() => true));
  const setPhotoCropTarget = vi.fn();
  const setRecropWarn = vi.fn();
  const setStudioOpen = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook((p: { cropTarget: unknown; studioOpen: boolean }) => usePhotoDialogSaves({
    performPhotoCropSave: performPhotoCropSave as never, performPhotoAnnotationSave: performPhotoAnnotationSave as never,
    setPhotoCropTarget: setPhotoCropTarget as never, setRecropWarn: setRecropWarn as never, setStudioOpen,
    annotateChecked: (opts.annotateChecked ?? (async () => true)) as never, photoCropTarget: p.cropTarget as never, studioOpen: p.studioOpen,
  }), { wrapper, initialProps: { cropTarget: target as unknown, studioOpen: true } });
  return { ds, hook, performPhotoCropSave, performPhotoAnnotationSave, setPhotoCropTarget, setStudioOpen };
}

describe('the frame between admission and the dialog being gone', () => {
  it('crop: a press in that frame is dropped silently; once the dialog has closed a new one works', async () => {
    let answer: OnChecked | undefined;
    const { ds, hook, performPhotoCropSave } = setup({ performCrop: (_t, _b, _c, cb) => { answer = cb; } });
    act(() => hook.result.current.saveCrop(target as never, jpeg(), CROP));
    expect(performPhotoCropSave).toHaveBeenCalledTimes(1);
    act(() => { answer?.(true); }); // admitted: the close is requested, React has not committed it yet
    act(() => hook.result.current.saveCrop(target as never, jpeg(), CROP)); // same dialog, same frame
    expect(performPhotoCropSave).toHaveBeenCalledTimes(1);
    expect(ds.notifications).toEqual([]);
    hook.rerender({ cropTarget: null, studioOpen: true }); // the close committed
    const next = { ...target };
    hook.rerender({ cropTarget: next, studioOpen: true }); // the dialog opened again for the same photo
    act(() => hook.result.current.saveCrop(next as never, jpeg(), CROP));
    expect(performPhotoCropSave).toHaveBeenCalledTimes(2);
  });

  it('studio: the same', async () => {
    let answer: OnChecked | undefined;
    const { ds, hook, performPhotoAnnotationSave } = setup({ performAnnotation: (...a) => { answer = a[3] as OnChecked; return true; } });
    const t = { itemId: 'i1', photoIndex: 0 };
    act(() => hook.result.current.saveAnnotation(t, jpeg(), '[]'));
    act(() => { answer?.(true); });
    act(() => hook.result.current.saveAnnotation(t, jpeg(), '[]'));
    expect(performPhotoAnnotationSave).toHaveBeenCalledTimes(1);
    expect(ds.notifications).toEqual([]);
    hook.rerender({ cropTarget: target, studioOpen: false });
    hook.rerender({ cropTarget: target, studioOpen: true });
    act(() => hook.result.current.saveAnnotation(t, jpeg(), '[]'));
    expect(performPhotoAnnotationSave).toHaveBeenCalledTimes(2);
  });

  it('CONTROL - a refused save frees the dialog at once (it stays open and Save works again)', async () => {
    let answer: OnChecked | undefined;
    const { hook, performPhotoCropSave } = setup({ performCrop: (_t, _b, _c, cb) => { answer = cb; } });
    act(() => hook.result.current.saveCrop(target as never, jpeg(), CROP));
    act(() => { answer?.(false); });
    act(() => hook.result.current.saveCrop(target as never, jpeg(), CROP));
    expect(performPhotoCropSave).toHaveBeenCalledTimes(2);
  });
});

describe('a save that throws before it starts', () => {
  it('crop: says the save failed once and the next Save is not dropped', () => {
    let boom = true;
    const { ds, hook, performPhotoCropSave } = setup({ performCrop: () => { if (boom) throw new Error('secret detail'); } });
    act(() => hook.result.current.saveCrop(target as never, jpeg(), CROP));
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_failed()]);
    expect(JSON.stringify(ds.notifications)).not.toContain('secret');
    boom = false;
    act(() => hook.result.current.saveCrop(target as never, jpeg(), CROP));
    expect(performPhotoCropSave).toHaveBeenCalledTimes(2);
  });

  it('annotation: the same', () => {
    let boom = true;
    const { ds, hook, performPhotoAnnotationSave } = setup({ performAnnotation: () => { if (boom) throw new Error('x'); return true; } });
    act(() => hook.result.current.saveAnnotation({ itemId: 'i1', photoIndex: 0 }, jpeg(), '[]'));
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_failed()]);
    boom = false;
    act(() => hook.result.current.saveAnnotation({ itemId: 'i1', photoIndex: 0 }, jpeg(), '[]'));
    expect(performPhotoAnnotationSave).toHaveBeenCalledTimes(2);
  });
});

describe('the discard-annotation check', () => {
  const withAnnotation = { ...target, hasAnnotation: true };

  it('says why once when the image is refused', async () => {
    const { ds, hook } = setup();
    act(() => hook.result.current.saveCrop(withAnnotation as never, huge(), CROP));
    await flush();
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_too_large()]);
  });

  it('says nothing when the dialog was cancelled while the check ran', async () => {
    const { ds, hook } = setup();
    act(() => { hook.result.current.saveCrop(withAnnotation as never, huge(), CROP); hook.result.current.cancelCrop(); });
    await flush();
    expect(ds.notifications).toEqual([]);
  });
});

describe('the pre-connect relay', () => {
  const t = { itemId: 'i1', photoIndex: 0 };
  const relay = (settle: (on: OnChecked | undefined) => Promise<boolean>) =>
    setup({ performAnnotation: () => false, annotateChecked: (_i, on) => settle(on) });

  it('hands the check a listener that calls the save off once the studio was closed', async () => {
    let listener: OnChecked | undefined;
    const { hook, setStudioOpen } = relay((on) => { listener = on; return Promise.resolve(false); });
    act(() => hook.result.current.saveAnnotation(t, jpeg(), '[]'));
    expect(listener?.(false)).toBeUndefined(); // still live
    act(() => hook.result.current.closeStudio());
    expect(listener?.(false)).toBe(false); // cancelled: the check must stay silent
    setStudioOpen.mockClear();
    await flush();
    expect(setStudioOpen).not.toHaveBeenCalled();
  });

  it('a refusal keeps the studio open and frees Save; an admitted image closes it', async () => {
    const answers = [false, true];
    const { hook, setStudioOpen } = relay(() => Promise.resolve(answers.shift()!));
    act(() => hook.result.current.saveAnnotation(t, jpeg(), '[]'));
    await flush();
    expect(setStudioOpen).not.toHaveBeenCalled();
    act(() => hook.result.current.saveAnnotation(t, jpeg(), '[]'));
    await flush();
    expect(setStudioOpen).toHaveBeenCalledWith(false);
  });
});
