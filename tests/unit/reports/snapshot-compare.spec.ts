/**
 * "Unchanged since the latest version" compares CONTENT, not strings.
 *
 * Opening an item on a reopened report and publishing without typing made a new version although nothing was edited:
 * the findings are projected from a live collaborative document, and the key order of that projection is not stable
 * across a reload of the document, so two snapshots of the same report differed as strings. Key order is the one
 * difference that carries no content and is normalised away. Every real change (a rating, a note, a defect, a photo,
 * a unit, the cover, an inspection column) must still differ, and arrays keep their order.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { compareSnapshots } from '../../../server/lib/snapshot-compare';

const sameSnapshot = (a: string, b: string) => compareSnapshots(a, b).same;
const differingSnapshotKeys = (a: string, b: string) => compareSnapshots(a, b).differs;

const base = () => ({
    schemaVersion: 4,
    inspection: { id: 'i1', propertyAddress: '1 Main St', coverPhotoId: null, reportStatus: 'published' },
    data: {
        'sec::roof': { rating: 'good', notes: 'ok', photos: [{ key: 'a.jpg' }, { key: 'b.jpg' }], tabs: { defects: [{ cannedId: 'd1', included: true }] } },
        'sec::attic': { rating: 'fair' },
    },
    units: [{ id: 'u1', name: 'Unit 1' }],
    presentation: { defectCategories: [], timeZone: 'UTC' },
});
const json = (o: unknown) => JSON.stringify(o);

describe('sameSnapshot', () => {
    it('is the same report when only the order of object keys differs (at any depth)', () => {
        const a = base();
        const b = {
            presentation: a.presentation,
            units: a.units,
            data: {
                'sec::attic': { rating: 'fair' },
                'sec::roof': { tabs: { defects: [{ included: true, cannedId: 'd1' }] }, photos: [{ key: 'a.jpg' }, { key: 'b.jpg' }], notes: 'ok', rating: 'good' },
            },
            inspection: { reportStatus: 'published', coverPhotoId: null, propertyAddress: '1 Main St', id: 'i1' },
            schemaVersion: 4,
        };
        expect(json(a)).not.toBe(json(b));
        expect(sameSnapshot(json(a), json(b))).toBe(true);
    });

    // Each real change below is paired with the reordered-but-equal case above, so a comparison that ignores everything cannot pass both.
    const changes: Array<[string, (s: ReturnType<typeof base>) => void]> = [
        ['a rating', (s) => { s.data['sec::roof'].rating = 'poor'; }],
        ['a note', (s) => { s.data['sec::roof'].notes = 'leaks'; }],
        ['a defect', (s) => { s.data['sec::roof'].tabs.defects[0].included = false; }],
        ['a photo added', (s) => { s.data['sec::roof'].photos.push({ key: 'c.jpg' }); }],
        ['photo order', (s) => { s.data['sec::roof'].photos.reverse(); }],
        ['a unit', (s) => { s.units[0].name = 'Unit 2'; }],
        ['the cover', (s) => { s.inspection.coverPhotoId = 'cover.jpg' as never; }],
        ['an inspection column', (s) => { s.inspection.propertyAddress = '2 Main St'; }],
        ['the report status', (s) => { s.inspection.reportStatus = 'in_progress'; }],
        ['a new finding', (s) => { (s.data as Record<string, unknown>)['sec::new'] = { rating: 'good' }; }],
        ['a removed finding', (s) => { delete (s.data as Record<string, unknown>)['sec::attic']; }],
    ];
    it.each(changes)('still differs for %s', (_name, mutate) => {
        const changed = base();
        mutate(changed);
        expect(sameSnapshot(json(base()), json(changed))).toBe(false);
    });

    it('treats an unreadable snapshot as different, never as the same', () => {
        expect(sameSnapshot('not json', json(base()))).toBe(false);
        expect(sameSnapshot(json(base()), '[]')).toBe(false);
    });

    describe('the step from version 3 to 4', () => {
        const v3 = () => { const s: Record<string, unknown> = base(); delete s.presentation; s.schemaVersion = 3; return s; };
        it('is not a change by itself', () => expect(sameSnapshot(json(v3()), json(base()))).toBe(true));
        it('still sees a content change', () => {
            const changed = base();
            changed.data['sec::roof'].rating = 'poor';
            expect(sameSnapshot(json(v3()), json(changed))).toBe(false);
        });
        it('a stored version 4 compares in full, so a settings change counts', () => {
            const changed = base();
            changed.presentation.timeZone = 'Asia/Tokyo';
            expect(sameSnapshot(json(base()), json(changed))).toBe(false);
        });
    });
});

describe('differingSnapshotKeys', () => {
    it('names the parts that moved, never their values', () => {
        const changed = base();
        changed.data['sec::roof'].rating = 'SECRET-VALUE';
        changed.inspection.propertyAddress = 'SECRET-ADDRESS';
        changed.units[0].name = 'x';
        const keys = differingSnapshotKeys(json(base()), json(changed));
        expect(keys.sort()).toEqual(['data.sec::roof', 'inspection.propertyAddress', 'units']);
        expect(keys.join(',')).not.toContain('SECRET');
    });

    it('reports nothing for a pure reorder (control) and is capped', () => {
        expect(differingSnapshotKeys(json(base()), json({ ...base(), data: { 'sec::attic': { rating: 'fair' }, 'sec::roof': base().data['sec::roof'] } }))).toEqual([]);
        const many = { ...base(), data: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, { rating: 'x' }])) };
        expect(differingSnapshotKeys(json(base()), json(many)).length).toBeLessThanOrEqual(20);
    });
});

describe('compareSnapshots - cost and the log', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses each side exactly once, whether or not they differ, and not at all when the strings are equal', () => {
    const parse = vi.spyOn(JSON, 'parse');
    const changed = base();
    changed.data['sec::roof'].rating = 'poor';
    compareSnapshots(json(base()), json(changed));
    expect(parse).toHaveBeenCalledTimes(2);
    parse.mockClear();
    compareSnapshots(json(base()), json({ ...base(), data: { 'sec::attic': base().data['sec::attic'], 'sec::roof': base().data['sec::roof'] } }));
    expect(parse).toHaveBeenCalledTimes(2);
    parse.mockClear();
    expect(compareSnapshots(json(base()), json(base())).same).toBe(true);
    expect(parse).not.toHaveBeenCalled();
  });

  it('does not list schemaVersion or presentation for a stored version 3 against a fresh version 4 (the allowance applies before diffing)', () => {
    const v3: Record<string, unknown> = base();
    delete v3.presentation;
    v3.schemaVersion = 3;
    expect(compareSnapshots(json(v3), json(base()))).toEqual({ same: true, differs: [] });
    const changed = base();
    changed.data['sec::roof'].rating = 'poor';
    expect(compareSnapshots(json(v3), json(changed)).differs).toEqual(['data.sec::roof']);
    // Control: a stored version 4 does list a presentation change.
    const moved = base();
    moved.presentation.timeZone = 'Asia/Tokyo';
    expect(compareSnapshots(json(base()), json(moved)).differs).toEqual(['presentation']);
  });

  it('a key present on one side only differs even when its value is null', () => {
    const withNull = { ...base(), extra: null };
    expect(compareSnapshots(json(base()), json(withNull))).toEqual({ same: false, differs: ['extra'] });
  });
});
