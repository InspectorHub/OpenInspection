import { describe, expect, it } from 'vitest';
import { liveGalleryRow } from './live-gallery-row';
import type { GalleryPhoto } from './inspection-media';

const row: GalleryPhoto = {
  key: 'T/i/photos/M.annotated.aaaaaaaa.png', url: '/api/inspections/i/photo?key=T%2Fi%2Fphotos%2FM.annotated.aaaaaaaa.png&w=480',
  label: 'Roof', itemId: 'it1', photoIndex: 1, originalKey: 'T/i/photos/M.jpg', annotated: true,
};

describe('liveGalleryRow', () => {
  it('shows the key and image the editor has now, when the listing is behind (a bake the server has not caught up with)', () => {
    const live = liveGalleryRow(row, [{ key: 'x' }, { key: 'T/i/photos/M.jpg', annotatedKey: 'T/i/photos/M.annotated.bbbbbbbb.png' }]);
    expect(live.key).toBe('T/i/photos/M.annotated.bbbbbbbb.png');
    expect(live.url).toBe('/api/inspections/i/photo?key=T%2Fi%2Fphotos%2FM.annotated.bbbbbbbb.png&w=480');
    expect(live.annotated).toBe(true);
    expect(live.originalKey).toBe('T/i/photos/M.jpg');
  });

  it('follows a crop, which drops the annotation', () => {
    const live = liveGalleryRow(row, [{ key: 'x' }, { key: 'T/i/photos/M.jpg', croppedKey: 'T/i/photos/M.cropped.cccccccc.jpg' }]);
    expect(live.key).toBe('T/i/photos/M.cropped.cccccccc.jpg');
    expect(live.annotated).toBe(false);
    expect(live.croppedKey).toBe('T/i/photos/M.cropped.cccccccc.jpg');
  });

  it('leaves a row alone when nothing changed, or it cannot be matched to a live entry', () => {
    expect(liveGalleryRow(row, [{ key: 'x' }, { key: 'T/i/photos/M.jpg', annotatedKey: row.key }])).toBe(row);
    expect(liveGalleryRow(row, [{ key: 'x' }, { key: 'someone-else.jpg', annotatedKey: 'z' }])).toBe(row);
    expect(liveGalleryRow(row, [])).toBe(row);
    const loose: GalleryPhoto = { key: 'p', url: '/u?key=p', label: 'Unattached' };
    expect(liveGalleryRow(loose, [{ key: 'p', annotatedKey: 'q' }])).toBe(loose);
    const defect: GalleryPhoto = { ...row, defectId: 'd1' };
    expect(liveGalleryRow(defect, [{ key: 'x' }, { key: 'T/i/photos/M.jpg', annotatedKey: 'z' }])).toBe(defect);
  });
});
