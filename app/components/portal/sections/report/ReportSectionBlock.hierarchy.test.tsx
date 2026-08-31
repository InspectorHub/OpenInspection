// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { ReportSectionBlock } from './ReportSectionBlock';
import type { ReportItem, ReportSection } from './types';

const item = (id: string, label: string, parentId: string | null): ReportItem => ({
  id, label, parentId,
  rating: null, ratingColor: '#000', ratingLabel: null, severityBucket: 'none',
  notes: null, photos: [],
});

const sectionOf = (items: ReportItem[]): ReportSection => ({
  id: 's1', title: 'Roof', icon: null, defectCount: 0,
  disclaimerText: null, alwaysPageBreak: false, items,
});

const nested = sectionOf([
  item('a', 'Sealed Roof Deck', null),
  item('a1', 'Fully adhered', 'a'),
]);

const renderBlock = (section: ReportSection) => render(
  <ReportSectionBlock section={section} sectionIdx={0} filter="all"
                      showEstimates={false} showPhotos={false} mediaVisible={() => true}
                      renderMediaTile={() => null} repairItems={{}} onToggleRepairItem={() => {}} />,
);

test('a sub-item renders inside its parent, not as a peer card', () => {
  // A card of its own says "this is as important as everything around it".
  // "check here if entire roof deck underside covered" is not -- it qualifies
  // the row above it, and a peer card makes the report say the wrong thing.
  renderBlock(nested);
  const parent = screen.getByText('Sealed Roof Deck').closest('[data-report-item]') as HTMLElement;
  expect(parent.querySelector('[data-report-subitem]')).toBeTruthy();
  expect(screen.getAllByTestId('report-item-card')).toHaveLength(2);
  expect(screen.getAllByTestId('report-item-card').filter((c) => c.dataset.nested === 'true'))
    .toHaveLength(1);
});

test('a flat section still renders one TOP-LEVEL card per item', () => {
  // Positive control: nesting everything into the first card would pass above.
  renderBlock(sectionOf([item('a', 'Sealed Roof Deck', null), item('b', 'Roof covering', null)]));
  expect(document.querySelectorAll('[data-report-item]')).toHaveLength(2);
  expect(document.querySelectorAll('[data-report-subitem]')).toHaveLength(0);
});

test('an item whose parent is not in the rendered list becomes a top-level card', () => {
  // The `defects` filter drops items, so a child can survive a parent that did
  // not. Failing open to a top-level card keeps it visible rather than making
  // it disappear into a card that is not there.
  renderBlock(sectionOf([item('a1', 'Fully adhered', 'a')]));
  expect(document.querySelectorAll('[data-report-item]')).toHaveLength(1);
  expect(screen.getByText('Fully adhered')).toBeTruthy();
});

test('a THIRD level is printed too, indented one step further', () => {
  // The one way this renderer can lose content: taking only DIRECT children of
  // a top-level item drops every grandchild, and a report that prints less
  // does not throw. It reads the whole subtree instead.
  renderBlock(sectionOf([
    item('a', 'Sealed Roof Deck', null),
    item('a1', 'Fully adhered', 'a'),
    item('a1x', 'entire underside', 'a1'),
  ]));
  expect(screen.getByText('entire underside')).toBeTruthy();
  const sub = [...document.querySelectorAll('[data-report-subitem]')] as HTMLElement[];
  expect(sub).toHaveLength(2);
  // Measured, not read off a class: the depth has to reach the page as a real
  // offset, and the two levels have to be told apart.
  const offsets = sub.map((el) => parseFloat(getComputedStyle(el).marginInlineStart));
  expect(offsets).toEqual([16, 32]);
});

test('every item in the section reaches the page exactly once', () => {
  // The invariant the whole flat-array design rests on. A walk that forgets to
  // recurse prints LESS and throws nothing, so the count is the assertion.
  renderBlock(sectionOf([
    item('a', 'Sealed Roof Deck', null),
    item('a1', 'Fully adhered', 'a'),
    item('a1x', 'entire underside', 'a1'),
    item('b', 'Roof covering', null),
  ]));
  expect(screen.getAllByTestId('report-item-card')).toHaveLength(4);
});
