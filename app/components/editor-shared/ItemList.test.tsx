import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from '~/components/editor-shared/ItemList';

const items = [
  { id: 'i1', label: 'Roof Covering', type: 'rich' },
  { id: 'i2', label: 'Roof Age', type: 'number' },
];

test('fill mode renders items with no filter chips (filtering lives in the editor header)', () => {
  render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      results={{ '_default:s1:i1': { rating: 'Defect' } }} />
  );
  expect(screen.getByText('Roof Covering')).toBeTruthy();
  // The shared list no longer owns filter chips — inspection-edit's header row
  // (with per-filter counts + a working Flagged filter) is the single owner.
  expect(screen.queryByText('Unrated')).toBeNull();
  expect(screen.queryByText('Flagged')).toBeNull();
});

// Phase U (Batch C1) regression — the rating dot must reflect ONLY the active
// unit's scope, never leak another unit's rating via the bare-itemId fallback.
function dotCount(container: HTMLElement): number {
  return container.querySelectorAll('span.rounded-full').length;
}

test('per-unit scope: rating dot reflects the active unit, not a bare-itemId leak', () => {
  // i1 is rated in u2 and in the common (_default) scope, but NOT in u1.
  const results = {
    'u2:s1:i1': { rating: 'Defect' },
    '_default:s1:i1': { rating: 'Defect' },
  };
  // Active unit u1 → i1 is unrated here; the u2/_default entries must NOT show.
  const u1 = render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      results={results} activeUnitId="u1" />
  );
  expect(dotCount(u1.container)).toBe(0);
  u1.unmount();

  // Active unit u2 → i1 IS rated; exactly one dot shows.
  const u2 = render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      results={results} activeUnitId="u2" />
  );
  expect(dotCount(u2.container)).toBe(1);
  u2.unmount();

  // Common scope (activeUnitId null, the default) → reads _default; dot shows.
  const common = render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      results={{ '_default:s1:i1': { rating: 'Defect' } }} />
  );
  expect(dotCount(common.container)).toBe(1);
});

test('author mode shows item type badge and a drag handle, no filter chips', () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={() => {}}
      onMoveItem={() => {}} onReorderItem={() => {}} onAddItem={() => {}} />
  );
  expect(screen.queryByText('Unrated')).toBeNull();
  expect(screen.getByText('number')).toBeTruthy(); // type badge
  expect(screen.getByLabelText('Drag Roof Covering')).toBeTruthy();
});
