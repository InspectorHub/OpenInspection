// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from '~/components/editor-shared/ItemList';

const nested = [
  { id: 'a',   label: 'Sealed Roof Deck', type: 'boolean', parentId: null },
  { id: 'a1',  label: 'Fully adhered',    type: 'boolean', parentId: 'a' },
  { id: 'a1x', label: 'entire underside', type: 'boolean', parentId: 'a1' },
  { id: 'b',   label: 'Roof covering',    type: 'boolean', parentId: null },
];
const flat = [
  { id: 'x', label: 'One', type: 'boolean' },
  { id: 'y', label: 'Two', type: 'boolean' },
];

const renderList = (
  items: Array<{ id: string; label: string; type: string; parentId?: string | null }>,
  extra: Record<string, unknown> = {},
) =>
  render(<ItemList mode="author" items={items} sectionId="s1" activeItemId={null}
                   onSelect={vi.fn()} onAddItem={vi.fn()} {...extra} />);

const spacerFor = (label: string) => {
  const row = screen.getByText(label).closest('[data-sortable-item]') as HTMLElement;
  return row.querySelector('[data-indent-spacer]') as HTMLElement;
};

/** The row's indent as the browser resolves it, in pixels. */
const indentPx = (label: string) => {
  const value = getComputedStyle(spacerFor(label)).inlineSize;
  // An empty value is a MISSING width, not a zero one -- it would mean the row
  // stopped declaring its depth at all, and every depth-0 assertion below would
  // then pass against a spacer that says nothing.
  expect(value).not.toBe('');
  return parseFloat(value);
};

test('indentation is a measured width, not a padding class', () => {
  // The row's own className string already sets padding (`px-3` / `pr-1`) and
  // is concatenated, not tailwind-merged. Appending `pl-6` there would leave
  // two utilities of equal specificity, resolved by stylesheet order rather
  // than by the order they appear on the element -- correct today, silently
  // wrong after an unrelated Tailwind bump. So the assertion reads the
  // computed width, which a class-name assertion would pass without.
  renderList(nested);
  expect(indentPx('Sealed Roof Deck')).toBe(0);
  expect(indentPx('Fully adhered')).toBe(14);
  expect(indentPx('entire underside')).toBe(28);
});

test('a flat list renders a zero-width spacer, not a missing one', () => {
  // Positive control. Removing the spacer for depth 0 would make the two
  // assertions above pass while changing how every stored template renders.
  renderList(flat);
  expect(spacerFor('One')).toBeTruthy();
  expect(indentPx('One')).toBe(0);
});

test('the outline number replaces the flat counter and survives truncation', () => {
  renderList(nested);
  expect(screen.getByText('A')).toBeTruthy();
  expect(screen.getByText('A.1')).toBeTruthy();
  expect(screen.getByText('A.1.a')).toBeTruthy();
  expect(screen.getByText('B')).toBeTruthy();
});

test('a flat list still numbers A, B — never 01, 02', () => {
  renderList(flat);
  expect(screen.getByText('A')).toBeTruthy();
  expect(screen.queryByText('01')).toBeNull();
});

test('a dangling parentId renders flat rather than crashing', () => {
  // Arrives from a duplicated section written before the fix, or a
  // platform-written row. Failing open to flat is the contract.
  renderList([{ id: 'z', label: 'Orphan', type: 'boolean', parentId: 'gone' }]);
  expect(indentPx('Orphan')).toBe(0);
});

test('the guide rail is drawn on nested rows only', () => {
  // Measured, not read off a class: an indent alone leaves a child scrolled
  // away from its parent with nothing saying whose child it is, and a rail
  // that renders at zero width says it just as badly as one that is absent.
  renderList(nested);
  expect(getComputedStyle(spacerFor('Fully adhered')).borderInlineStartWidth).toBe('1px');
  expect(getComputedStyle(spacerFor('Sealed Roof Deck')).borderInlineStartWidth).not.toBe('1px');
});
