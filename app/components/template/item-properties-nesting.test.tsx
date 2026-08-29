// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemPropertiesPanel } from './ItemPropertiesPanel';
import type { TemplateItem } from './types';
import { asSelect } from '../../../tests/helpers/dom';

const siblings: TemplateItem[] = [
  { id: 'a',   label: 'Sealed Roof Deck', type: 'boolean' },
  { id: 'a1',  label: 'Fully adhered',    type: 'boolean', parentId: 'a' },
  { id: 'a1x', label: 'entire underside', type: 'boolean', parentId: 'a1' },
];

const optionsOf = () =>
  [...asSelect(screen.getByLabelText('Nests under'), 'the nest-under picker').options].map((o) => o.value);

test("offers every item that can legally be this one's parent", () => {
  render(<ItemPropertiesPanel selectedItem={siblings[0]} sectionItems={siblings}
                              updateItem={vi.fn()} choicesText="" setChoicesText={vi.fn()} />);
  const values = optionsOf();
  expect(values).toContain('');       // Top level
  // Its own descendants are not offered: choosing one would mint a cycle.
  expect(values).not.toContain('a');
  expect(values).not.toContain('a1');
  expect(values).not.toContain('a1x');
});

test('offers an unrelated item as a parent', () => {
  // Positive control: a picker offering nothing at all would pass the
  // exclusions above.
  const withPeer: TemplateItem[] = [...siblings, { id: 'b', label: 'Roof covering', type: 'boolean' }];
  render(<ItemPropertiesPanel selectedItem={withPeer[3]} sectionItems={withPeer}
                              updateItem={vi.fn()} choicesText="" setChoicesText={vi.fn()} />);
  expect(optionsOf()).toContain('a');
});

test('does not offer an item already at the depth cap', () => {
  // `a1` sits at depth 1, so a child of it would be depth 2 -- the deepest
  // allowed. `a1x` is already at depth 2 and can hold nothing.
  const withPeer: TemplateItem[] = [...siblings, { id: 'b', label: 'Roof covering', type: 'boolean' }];
  render(<ItemPropertiesPanel selectedItem={withPeer[3]} sectionItems={withPeer}
                              updateItem={vi.fn()} choicesText="" setChoicesText={vi.fn()} />);
  const values = optionsOf();
  expect(values).toContain('a1');
  expect(values).not.toContain('a1x');
});

test('choosing Top level sends an explicit null, not an omission', () => {
  // Omitting the key would leave the stored document's old parentId in place:
  // the author un-nests an item, saves, reloads, and it is nested again.
  const updateItem = vi.fn();
  render(<ItemPropertiesPanel selectedItem={siblings[1]} sectionItems={siblings}
                              updateItem={updateItem} choicesText="" setChoicesText={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Nests under'), { target: { value: '' } });
  expect(updateItem).toHaveBeenCalledWith('a1', { parentId: null });
});
