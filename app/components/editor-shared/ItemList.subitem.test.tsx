// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from '~/components/editor-shared/ItemList';
import type { EditorGroup } from '~/lib/editor/statutory-groups';

const items = [
  { id: 'a',   label: 'Sealed Roof Deck', type: 'boolean', parentId: null },
  { id: 'a1',  label: 'Fully adhered',    type: 'boolean', parentId: 'a' },
  { id: 'a1x', label: 'entire underside', type: 'boolean', parentId: 'a1' },
];

const openMenuFor = (label: string) => {
  const row = screen.getByText(label).closest('[data-sortable-item]') as HTMLElement;
  fireEvent.click(row.querySelector('[aria-haspopup="true"]') as HTMLElement);
};

const renderList = (extra: Record<string, unknown> = {}) => render(
  <ItemList mode="author" items={items} sectionId="s1" activeItemId={null}
            onSelect={vi.fn()} onAddItem={vi.fn()} onDeleteItem={vi.fn()}
            onDuplicateItem={vi.fn()} onMoveItem={vi.fn()} {...extra} />,
);

test('offers Add sub-item on an item that can still take one', () => {
  renderList({ onAddSubItem: vi.fn() });
  openMenuFor('Sealed Roof Deck');
  expect(screen.getByText('+ Add sub-item')).toBeTruthy();
});

test('at the depth cap the entry is present, disabled, and names the limit', () => {
  // It used to be omitted entirely. An absent entry is not a refusal a reader
  // can learn from — the rule exists nowhere on screen, and the author is left
  // comparing one row's menu against another's to infer it. Disabled, carrying
  // the limit, answers the question where it is asked.
  const onAddSubItem = vi.fn();
  renderList({ onAddSubItem });
  openMenuFor('entire underside');

  const entry = screen.getByText(/three levels is the limit/) as HTMLElement;
  expect(entry).toBeTruthy();
  expect((entry as HTMLButtonElement).disabled).toBe(true);

  // Disabled in fact, not only in appearance: the handler must not fire.
  fireEvent.click(entry);
  expect(onAddSubItem).not.toHaveBeenCalled();

  // And it is not the working entry wearing a longer label.
  expect(screen.queryByText('+ Add sub-item')).toBeNull();
});

test('does not offer it at all when no handler is passed', () => {
  // Positive control for the cap test: a component that never rendered the
  // entry would pass the assertion above for the wrong reason.
  renderList();
  openMenuFor('Sealed Roof Deck');
  expect(screen.queryByText('+ Add sub-item')).toBeNull();
});

test('a grouped template offers NEITHER add', () => {
  // Same reason `+ Add item` is already hidden when groups are declared: a
  // free item reaches no binding, so whatever is typed into it never arrives
  // on the authority's form and nothing says so. That argument does not get
  // weaker for a sub-item.
  const group: EditorGroup = {
    id: 'g', label: 'G', capacity: 1,
    slots: [{ index: 0, label: 'Slot', fields: { f: 'a' } }],
  };
  renderList({ onAddSubItem: vi.fn(), groups: [group], onAddGroupInstance: vi.fn() });
  expect(screen.queryByText('+ Add item')).toBeNull();
  openMenuFor('Sealed Roof Deck');
  expect(screen.queryByText('+ Add sub-item')).toBeNull();
});

test('deleting a parent asks first, and says how many go with it', () => {
  const onDeleteItem = vi.fn();
  renderList({ onDeleteItem, confirmSubtreeDelete: true });
  openMenuFor('Sealed Roof Deck');
  fireEvent.click(screen.getByText('Delete'));
  // NOT window.confirm -- a custom modal, per the repo rule.
  expect(screen.getByText(/and the 2 items under it/)).toBeTruthy();
  expect(onDeleteItem).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Delete all'));
  expect(onDeleteItem).toHaveBeenCalledWith('a');
});

test('deleting a leaf does not ask', () => {
  // Positive control: a confirm on every delete would pass the test above and
  // make the ordinary case worse.
  const onDeleteItem = vi.fn();
  renderList({ onDeleteItem, confirmSubtreeDelete: true });
  openMenuFor('entire underside');
  fireEvent.click(screen.getByText('Delete'));
  expect(onDeleteItem).toHaveBeenCalledWith('a1x');
  expect(screen.queryByText('Delete all')).toBeNull();
});

test('a caller that owns its own confirmation gets none from the list', () => {
  // The inspection editor routes every structural delete through
  // StructureDeleteModal, which counts ratings, notes and photos too. Two
  // modals for one click is worse than one, so this one is opt-in.
  const onDeleteItem = vi.fn();
  renderList({ onDeleteItem });
  openMenuFor('Sealed Roof Deck');
  fireEvent.click(screen.getByText('Delete'));
  expect(screen.queryByText(/items under it/)).toBeNull();
  expect(onDeleteItem).toHaveBeenCalledWith('a');
});
