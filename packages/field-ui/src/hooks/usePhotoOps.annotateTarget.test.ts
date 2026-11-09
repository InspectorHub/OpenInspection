// @vitest-environment happy-dom
/**
 * The viewer's Annotate opens the photo studio on exactly the photo that was clicked: the viewer's own item and
 * section (not the active item), the photo's real 0-based array index, the display key, and the crop as the base.
 */
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldDataSourceProvider } from '../context';
import { m } from '../i18n';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { GalleryPhoto } from '../shared/inspection-media';
import { usePhotoOps } from './usePhotoOps';

const ds = createFakeDataSource({ data: createEmptyEditorData() });
const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);

const PHOTOS_B = [
  { key: '', mediaType: 'video' },
  { key: 'b1.jpg' },
  { key: 'b2.jpg', croppedKey: 'b2-crop.jpg', annotatedKey: 'b2-ann.png' },
];

function setup() {
  const studio = {
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(),
    setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(), setPhotoStudioItem: vi.fn(),
  };
  const asked: Array<[string, string | undefined]> = [];
  const state = {
    inspection: { id: 'insp1', coverPhotoId: null },
    sections: [],
    results: {},
    // The active section is s1; item B lives in s2.
    currentSection: { id: 's1' },
    sectionIdForItem: (itemId: string) => (itemId === 'B' ? 's2' : 's1'),
    setResults: vi.fn(),
    setDirty: vi.fn(),
  };
  const findings = {
    getResult: (itemId: string, sectionId?: string) => {
      asked.push([itemId, sectionId]);
      return itemId === 'B' ? { photos: PHOTOS_B } : { photos: [{ key: 'a0.jpg' }] };
    },
  };
  const ctx = { state, findings, streamCustomerSubdomain: null, collabDoc: null, activeUnitId: null, ...studio };
  const { result } = renderHook(() => usePhotoOps(ctx as never), { wrapper });
  return { studio, asked, ops: result.current };
}

const row = (over: Partial<GalleryPhoto>): GalleryPhoto => ({ key: 'x', url: '/thumb', label: '', itemId: 'B', photoIndex: 2, originalKey: 'b2.jpg', ...over });

describe('onViewerAction annotate', () => {
  it('opens the studio on the clicked photo of the clicked item, by the live entry, not by the row', () => {
    const { studio, ops } = setup();
    act(() => ops.onViewerAction('annotate', row({ sectionId: 's2' })));
    expect(studio.setPhotoStudioItem).toHaveBeenCalledWith({ itemId: 'B', sectionId: 's2', originalKey: 'b2.jpg' });
    expect(studio.setPhotoStudioIndex).toHaveBeenCalledWith(2);
    expect(studio.setPhotoStudioKey).toHaveBeenCalledWith('b2-ann.png');
    expect(studio.setPhotoStudioUrl.mock.calls[0]![0]).toContain('b2-crop.jpg');
    expect(studio.setPhotoStudioUrl.mock.calls[0]![0]).not.toContain('b2-ann');
    expect(studio.setPhotoStudioOpen).toHaveBeenCalledWith(true);
  });

  it('a viewer row without a section falls back to the open section', () => {
    const { studio, ops } = setup();
    act(() => ops.onViewerAction('annotate', row({ photoIndex: 1, originalKey: 'b1.jpg' })));
    expect(studio.setPhotoStudioItem).toHaveBeenCalledWith({ itemId: 'B', sectionId: 's1', originalKey: 'b1.jpg' });
    expect(studio.setPhotoStudioIndex).toHaveBeenCalledWith(1);
    expect(studio.setPhotoStudioKey).toHaveBeenCalledWith('b1.jpg');
  });

  it('opens nothing when the entry at that index is not the photo the row names (the results moved on)', () => {
    const { studio, ops } = setup();
    const before = ds.notifications.length;
    act(() => ops.onViewerAction('annotate', row({ sectionId: 's2', originalKey: 'someone-else.jpg' })));
    expect(studio.setPhotoStudioOpen).not.toHaveBeenCalled();
    // Never a silent no-op: the person is told why nothing opened.
    expect(ds.notifications.slice(before).map((n) => n.message)).toEqual([m.editor_photo_annotate_unavailable()]);
  });

  it('an empty section id (a legacy bare finding key) counts as absent: the open section is used and nothing empty is asked for', () => {
    const { studio, asked, ops } = setup();
    act(() => ops.onViewerAction('annotate', row({ sectionId: '', photoIndex: 1, originalKey: 'b1.jpg' })));
    expect(studio.setPhotoStudioItem).toHaveBeenCalledWith({ itemId: 'B', sectionId: 's1', originalKey: 'b1.jpg' });
    expect(asked.filter(([, sectionId]) => sectionId === '')).toEqual([]);
  });

  it('opens nothing for a clip slot', () => {
    const { studio, ops } = setup();
    act(() => ops.onViewerAction('annotate', row({ sectionId: 's2', photoIndex: 0, originalKey: '', mediaType: 'photo' })));
    expect(studio.setPhotoStudioOpen).not.toHaveBeenCalled();
  });
});
