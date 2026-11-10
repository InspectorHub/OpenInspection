import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { projectionsMatch, projectionOfBytes } from '../../../server/lib/collab/projection-match';
import type { ItemEntry } from '../../../packages/field-ui/src/shared/results-doc.types';
import { appendPhoto, applyItemPatch, seedResultsDoc } from '../../../packages/field-ui/src/shared/results-doc';

const item = (over: ItemEntry = {}): ItemEntry => ({ notes: '', photos: [], ...over });
const photo = (key: string) => ({ key });

describe('projectionsMatch: do the document and the database hold the same findings?', () => {
    it('is true for equal projections, and for two with nothing in them', () => {
        expect(projectionsMatch({ 'a:b:c': item({ rating: 'defect' }) }, { 'a:b:c': item({ rating: 'defect' }) })).toBe(true);
        expect(projectionsMatch({}, {})).toBe(true);
        expect(projectionsMatch({}, null)).toBe(true);
        expect(projectionsMatch(null, null)).toBe(true);
    });

    it('is false for an item only the database has (a direct write the document lacks)', () => {
        expect(projectionsMatch({}, { 'a:b:c': item({ rating: 'defect' }) })).toBe(false);
        expect(projectionsMatch({ 'a:b:c': item() }, { 'a:b:c': item({ notes: 'typed directly' }) })).toBe(false);
    });

    it('is false for an item only the source has (it would resurrect something the database no longer holds)', () => {
        expect(projectionsMatch({ 'a:b:c': item({ rating: 'defect' }) }, {})).toBe(false);
        expect(projectionsMatch({ 'a:b:c': item({ rating: 'ok' }), 'x:y:z': item({ rating: 'ok' }) }, { 'a:b:c': item({ rating: 'ok' }) })).toBe(false);
    });

    it('is false for a changed value, and when the database deleted or cleared what the source still has', () => {
        expect(projectionsMatch({ 'a:b:c': item({ rating: 'ok' }) }, { 'a:b:c': item({ rating: 'defect' }) })).toBe(false);
        expect(projectionsMatch({ 'a:b:c': item({ rating: 'defect' }) }, { 'a:b:c': item() })).toBe(false);
        expect(projectionsMatch({ 'a:b:c': item({ notes: 'old note' }) }, { 'a:b:c': item({ notes: '' }) })).toBe(false);
        expect(projectionsMatch({ 'a:b:c': item({ photos: [photo('k1'), photo('k2')] }) }, { 'a:b:c': item({ photos: [photo('k1')] }) })).toBe(false);
    });

    it('treats every empty value as the same nothing, on both sides', () => {
        expect(projectionsMatch({ 'a:b:c': item({ notes: '', photos: [] }) }, {})).toBe(true);
        expect(projectionsMatch({}, { 'a:b:c': item({ value: false, attributes: {}, followupNotes: null }) })).toBe(true);
        expect(projectionsMatch({ 'a:b:c': { rating: 'ok' } }, { 'a:b:c': { rating: 'ok', notes: '', photos: [], value: false } })).toBe(true);
    });

    it('compares nested values and list order', () => {
        expect(projectionsMatch({ 'a:b:c': item({ attributes: { x: '1' } }) }, { 'a:b:c': item({ attributes: { x: '1' } }) })).toBe(true);
        expect(projectionsMatch({ 'a:b:c': item({ attributes: { x: '1' } }) }, { 'a:b:c': item({ attributes: { x: '2' } }) })).toBe(false);
        expect(projectionsMatch({ 'a:b:c': item({ photos: [photo('k1'), photo('k2')] }) }, { 'a:b:c': item({ photos: [photo('k2'), photo('k1')] }) })).toBe(false);
    });

    it('does not compare meta keys, which are written to the database directly and are not findings', () => {
        expect(projectionsMatch({ 'a:b:c': item() }, { _inspector_signature: { value: { name: 'x' } }, 'a:b:c': item() })).toBe(true);
        expect(projectionsMatch({ _inspector_signature: { value: { name: 'y' } } }, {})).toBe(true);
    });
});

describe('projectionOfBytes', () => {
    it('projects an encoded document the way the object does, and is null for bytes that are not one', () => {
        const d = new Y.Doc();
        seedResultsDoc(d, [{ findingKey: 'a:b:c' }]);
        applyItemPatch(d, 'a:b:c', 'rating', 'defect');
        appendPhoto(d, 'a:b:c', { key: 'k1' });
        const projection = projectionOfBytes(Y.encodeStateAsUpdate(d));
        expect(projection?.['a:b:c']?.rating).toBe('defect');
        expect(projection?.['a:b:c']?.photos).toHaveLength(1);
        expect(projectionOfBytes(new Uint8Array([255, 255, 255, 9, 9]))).toBeNull();
    });
});
