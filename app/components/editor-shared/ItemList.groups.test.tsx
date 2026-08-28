// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from '~/components/editor-shared/ItemList';
import type { EditorGroup } from '~/lib/editor/statutory-groups';

/**
 * Items as a form-shaped template hands them over: a flat run whose only clue
 * that two of them belong together is a prefix in the label. That is exactly
 * what this grouping prop exists to fix.
 */
const items = [
  { id: 'panel_main_type', label: 'Main panel - type', type: 'select' },
  { id: 'panel_main_amps', label: 'Main panel - total amps', type: 'number' },
  { id: 'panel_second_type', label: 'Second panel - type', type: 'select' },
  { id: 'panel_second_amps', label: 'Second panel - total amps', type: 'number' },
  { id: 'elec_condition', label: 'General condition', type: 'select' },
];

const group: EditorGroup = {
  id: 'electrical_panel',
  label: 'Electrical Panel',
  capacity: 2,
  overflowTo: 'additional_comments',
  slots: [
    { index: 0, label: 'Main Panel', fields: { type: 'panel_main_type', total_amps: 'panel_main_amps' } },
    { index: 1, label: 'Second Panel', fields: { type: 'panel_second_type', total_amps: 'panel_second_amps' } },
  ],
};

function renderGrouped(extra: Record<string, unknown> = {}) {
  return render(
    <ItemList
      mode="fill" items={items} sectionId="s1" activeItemId={null}
      onSelect={vi.fn()} groups={[group]} onAddItem={vi.fn()} {...extra}
    />,
  );
}

test('a slot is announced by the name the form prints over it', () => {
  // "Main" and "Second" are the page's own words. A reader handed "Panel 1"
  // has been told something the form does not say.
  renderGrouped();
  expect(screen.getByText('Main Panel')).toBeTruthy();
  expect(screen.getByText('Second Panel')).toBeTruthy();
});

test('every grouped item still renders, and so does the ungrouped one', () => {
  // Grouping is presentation. Nothing may disappear from the list because of it.
  renderGrouped();
  for (const item of items) expect(screen.getByText(item.label)).toBeTruthy();
});

test('"Add item" is suppressed while a grouping is in force', () => {
  // In a form template a free item reaches no binding, so whatever the
  // inspector types into it never arrives on the form and nothing tells him.
  // The friendliest button on the screen must stop being that trapdoor.
  renderGrouped();
  expect(screen.queryByText(/add item/i)).toBeNull();
});

test('the group offers an add of its own, naming what it adds', () => {
  const onAddInstance = vi.fn();
  renderGrouped({ onAddGroupInstance: onAddInstance });
  const add = screen.getByRole('button', { name: /electrical panel/i });
  add.click();
  expect(onAddInstance).toHaveBeenCalledWith('electrical_panel');
});

test('CONTROL — with no grouping the list is exactly what it was', () => {
  // The lock on template-edit and on every narrative template: absent `groups`,
  // nothing about this component changes, "Add item" included.
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId={null}
      onSelect={vi.fn()} onAddItem={vi.fn()} />,
  );
  expect(screen.getByText(/add item/i)).toBeTruthy();
  expect(screen.queryByText('Main Panel')).toBeNull();
  for (const item of items) expect(screen.getByText(item.label)).toBeTruthy();
});

test("the heading sits above the slot's FIRST item in the list, whatever order the bindings were written in", () => {
  // Caught in Chrome, not by the fixture above: a declaration's bindings are a
  // map, and their insertion order says nothing about where the items sit in
  // the section. Anchoring the heading to "the slot's first field as the
  // bindings happen to list it" puts it one row off -- and one row off means a
  // heading that claims the panel above it is the Second one.
  const shuffled: EditorGroup = {
    ...group,
    slots: [
      group.slots[0],
      // total_amps first, type second -- the reverse of their order in `items`.
      { index: 1, label: 'Second Panel', fields: { total_amps: 'panel_second_amps', type: 'panel_second_type' } },
    ],
  };
  const { container } = render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId={null}
      onSelect={vi.fn()} groups={[shuffled]} onAddItem={vi.fn()} />,
  );
  const text = container.textContent ?? '';
  const heading = text.indexOf('Second Panel');
  const firstItem = text.indexOf('Second panel - type');
  expect(heading).toBeGreaterThan(-1);
  expect(heading).toBeLessThan(firstItem);
});
