// @vitest-environment happy-dom
/**
 * The canned-comment library hook, through `resources.commentsLibrary`.
 *
 * It used to `fetch('/resources/comments-library')` itself (GET with query parameters, POST with
 * the intents `touch` and `save`). It now reads and writes through the data source's library
 * resource. Pinned here: the query it sends (members and their ORDER, which the web host
 * serialises as given), the touch and save fields, the localStorage fallback when a save is not
 * stored, and the same-frame guards on the two writes.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDataSourceProvider } from '../context';
import type { FieldResources } from '../data-source';
import { createEmptyEditorData, createFakeCommentsLibrary, createFakeDataSource, type FakeCommentsLibrary } from '../testing/fake-data-source';
import { useCannedComments } from './useCannedComments';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const ROW = { id: 'c1', text: 'Server text', category: 'Cat', severity: 'marginal', section: 'Roof' };

function setup(library: FakeCommentsLibrary | null = createFakeCommentsLibrary([ROW])) {
  const resources: FieldResources = library === null ? {} : { commentsLibrary: library };
  const ds = createFakeDataSource({ data: createEmptyEditorData(), resources });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(
    () => useCannedComments({ inspectionId: 'insp1', severityForRatingId: () => 'all' }),
    { wrapper },
  );
  return { library, hook };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

describe('reading', () => {
  it('loads the server library once on mount, with no filters, and maps the rows to snippets', async () => {
    const { library, hook } = setup();
    await settle();
    expect(library!.lists).toEqual([undefined]);
    expect(hook.result.current.userSnippets).toEqual([
      { id: 'c1', severity: 'marginal', section: 'Roof', category: 'Cat', text: 'Server text', source: 'snippet' },
    ]);
    expect(hook.result.current.commentPool.some((c) => c.text === 'Server text')).toBe(true);
  });

  it('maps a row with no severity, section or category to "all" and null', async () => {
    const { hook } = setup(createFakeCommentsLibrary([{ id: 'c2', text: 'Bare', category: null, severity: null, section: null }]));
    await settle();
    expect(hook.result.current.userSnippets[0]).toMatchObject({ severity: 'all', section: null, category: null });
  });

  it('has an empty server library when the host offers none', async () => {
    const { hook } = setup(null);
    await settle();
    expect(hook.result.current.userSnippets).toEqual([]);
    await expect(hook.result.current.fetchFiltered({})).resolves.toEqual([]);
  });

  it('fetchFiltered in auto mode sends sort, filterMode, search, severity, itemLabel, section in that order', async () => {
    const { library, hook } = setup();
    await settle();
    let rows: unknown;
    await act(async () => {
      rows = await hook.result.current.fetchFiltered({ itemLabel: 'Shingles', section: 'Roof', severity: 'significant', search: 'leak' });
    });
    const query = library!.lists[1]!;
    expect(Object.entries(query)).toEqual([
      ['sort', 'relevance'], ['filterMode', 'auto'], ['search', 'leak'], ['severity', 'significant'], ['itemLabel', 'Shingles'], ['section', 'Roof'],
    ]);
    expect(rows).toEqual([ROW]);
  });

  it('fetchFiltered leaves out empty members, and the item context in "all" mode, but keeps severity', async () => {
    const { library, hook } = setup();
    await settle();
    act(() => hook.result.current.setFilterMode('all'));
    act(() => hook.result.current.setSort('recent'));
    await act(async () => { await hook.result.current.fetchFiltered({ itemLabel: 'Shingles', section: 'Roof', severity: 'good', search: '' }); });
    expect(library!.lists[1]).toEqual({ sort: 'recent', filterMode: 'all', severity: 'good' });
    expect(Object.keys(library!.lists[1]!)).toEqual(['sort', 'filterMode', 'severity']);
    expect(localStorage.getItem('oi:library:sort')).toBe('recent');
    expect(localStorage.getItem('oi:library:filter-mode')).toBe('all');
  });

  it('searchLibrary asks nothing for fewer than two characters and otherwise searches the whole library', async () => {
    const { library, hook } = setup();
    await settle();
    await expect(hook.result.current.searchLibrary(' a ')).resolves.toEqual([]);
    expect(library!.lists).toHaveLength(1);
    let rows: unknown;
    await act(async () => { rows = await hook.result.current.searchLibrary(' roof '); });
    expect(Object.entries(library!.lists[1]!)).toEqual([['search', 'roof'], ['filterMode', 'all'], ['sort', 'relevance']]);
    expect(rows).toEqual([{ id: 'c1', severity: 'marginal', section: 'Roof', category: 'Cat', text: 'Server text', source: 'snippet' }]);
  });

  it('a rejected list answers an empty library instead of throwing', async () => {
    const library = createFakeCommentsLibrary();
    library.list = async () => { throw new Error('offline'); };
    const { hook } = setup(library);
    await settle();
    await expect(hook.result.current.fetchFiltered({})).resolves.toEqual([]);
  });
});

describe('touchSnippet', () => {
  it('records one use of the entry', async () => {
    const { library, hook } = setup();
    await settle();
    act(() => hook.result.current.touchSnippet('c1'));
    await settle();
    expect(library!.touches).toEqual(['c1']);
  });

  it('sends one touch for the same entry twice in one frame, another entry in the same frame goes through, and a later one is accepted', async () => {
    const { library, hook } = setup();
    await settle();
    act(() => {
      hook.result.current.touchSnippet('c1');
      hook.result.current.touchSnippet('c1');
      hook.result.current.touchSnippet('c2');
    });
    await settle();
    expect(library!.touches).toEqual(['c1', 'c2']);
    act(() => hook.result.current.touchSnippet('c1'));
    await settle();
    expect(library!.touches).toEqual(['c1', 'c2', 'c1']);
  });

  it('does nothing without a library, and a rejected touch does not break the next one', async () => {
    expect(() => setup(null).hook.result.current.touchSnippet('c1')).not.toThrow();
    const library = createFakeCommentsLibrary();
    let fail = true;
    const touched: string[] = [];
    library.touch = async (id) => { if (fail) throw new Error('boom'); touched.push(id); return { ok: true }; };
    const { hook } = setup(library);
    await settle();
    act(() => hook.result.current.touchSnippet('c1'));
    await settle();
    fail = false;
    act(() => hook.result.current.touchSnippet('c1'));
    await settle();
    expect(touched).toEqual(['c1']);
  });
});

describe('saveSnippet', () => {
  it('saves the entry with the same fields the form carried, reloads the library and answers true', async () => {
    const { library, hook } = setup();
    await settle();
    library!.setRows([ROW, { ...ROW, id: 'c9', text: 'Fresh' }]);
    let ok = false;
    await act(async () => { ok = await hook.result.current.saveSnippet('Fresh', 'significant', 'Roof', undefined, 'Shingles'); });
    expect(ok).toBe(true);
    expect(library!.saved()).toEqual([{ text: 'Fresh', severity: 'significant', section: 'Roof', category: '', itemLabel: 'Shingles' }]);
    // The reload carries no filters, like the first load.
    expect(library!.lists[library!.lists.length - 1]).toBeUndefined();
    expect(hook.result.current.userSnippets.map((s) => s.id)).toEqual(['c1', 'c9']);
    expect(localStorage.getItem('oi:snippets')).toBeNull();
  });

  it('sends a title as the category and an empty section/label as empty strings', async () => {
    const { library, hook } = setup();
    await settle();
    await act(async () => { await hook.result.current.saveSnippet('T', 'all', '', 'Title'); });
    expect(library!.saved()).toEqual([{ text: 'T', severity: 'all', section: '', category: 'Title', itemLabel: '' }]);
  });

  it('keeps the text on this device when the host did not store it, and refuses the same text twice', async () => {
    const library = createFakeCommentsLibrary([ROW]);
    library.failSave('nope');
    const { hook } = setup(library);
    await settle();
    let first = false;
    let second = true;
    await act(async () => { first = await hook.result.current.saveSnippet('Local only', 'good', 'Roof'); });
    await act(async () => { second = await hook.result.current.saveSnippet('Local only', 'good', 'Roof'); });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(JSON.parse(localStorage.getItem('oi:snippets') ?? '[]')).toEqual([{ severity: 'good', text: 'Local only', source: 'snippet' }]);
    expect(hook.result.current.commentPool.some((c) => c.text === 'Local only')).toBe(true);
  });

  it('falls back to this device when the host offers no library', async () => {
    const { hook } = setup(null);
    let ok = false;
    await act(async () => { ok = await hook.result.current.saveSnippet('No host', 'good', ''); });
    expect(ok).toBe(true);
    expect(localStorage.getItem('oi:snippets')).toContain('No host');
  });

  it('a save that rejects falls back to this device', async () => {
    const library = createFakeCommentsLibrary();
    library.save = async () => { throw new Error('boom'); };
    const { hook } = setup(library);
    let ok = false;
    await act(async () => { ok = await hook.result.current.saveSnippet('After throw', 'good', ''); });
    expect(ok).toBe(true);
    expect(localStorage.getItem('oi:snippets')).toContain('After throw');
  });

  it('two identical saves in one frame send one request and both callers get its answer; a different entry is its own request', async () => {
    const { library, hook } = setup();
    await settle();
    const answers: boolean[] = [];
    await act(async () => {
      const a = hook.result.current.saveSnippet('Same', 'good', 'Roof');
      const b = hook.result.current.saveSnippet('Same', 'good', 'Roof');
      const c = hook.result.current.saveSnippet('Other', 'good', 'Roof');
      answers.push(...(await Promise.all([a, b, c])));
    });
    expect(library!.saved().map((s) => s.text)).toEqual(['Same', 'Other']);
    expect(answers).toEqual([true, true, true]);
    // Once settled the same entry can be saved again.
    await act(async () => { await hook.result.current.saveSnippet('Same', 'good', 'Roof'); });
    expect(library!.saved().map((s) => s.text)).toEqual(['Same', 'Other', 'Same']);
  });
});
