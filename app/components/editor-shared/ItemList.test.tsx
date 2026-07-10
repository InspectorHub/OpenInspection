import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from '~/components/editor-shared/ItemList';

const items = [
  { id: 'i1', label: 'Roof Covering', type: 'rich' },
  { id: 'i2', label: 'Roof Age', type: 'number' },
];

test('fill mode shows filter chips and rating dot for rated items', () => {
  render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      results={{ '_default:s1:i1': { rating: 'Defect' } }} />
  );
  expect(screen.getByText('Unrated')).toBeTruthy(); // filter chip
  expect(screen.getByText('Roof Covering')).toBeTruthy();
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
