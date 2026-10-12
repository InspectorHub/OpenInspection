// @vitest-environment happy-dom
// Invariant: choosing Delete in a row's ⋯ menu closes the menu, focuses the ⋯
// button, and the confirm dialog records THAT button, so Escape / Cancel returns
// focus to it instead of dropping it to <body>.
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import { Modal } from '@core/shared-ui';
import { ItemList } from '~/components/editor-shared/ItemList';
import { SectionRail } from '~/components/editor-shared/SectionRail';

const items = [
  { id: 'i1', label: 'Roof Covering', type: 'rich' },
  { id: 'i2', label: 'Flashing', type: 'rich', parentId: 'i1' },
];

function dots(): HTMLElement {
  const el = document.querySelector('[aria-haspopup="true"]');
  if (!el) throw new Error('no menu button');
  return el as HTMLElement;
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test('item menu: Delete -> confirm -> Escape returns focus to the menu button', async () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onDeleteItem={vi.fn()} confirmSubtreeDelete />
  );
  const anchor = dots();
  fireEvent.click(anchor);
  expect(screen.getByRole('menu')).toBeTruthy();
  // The menu panel is not an (unnamed) dialog; only the confirm will be one.
  expect(screen.queryAllByRole('dialog').length).toBe(0);
  fireEvent.click(screen.getByText('Delete'));
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getAllByRole('dialog').length).toBe(1);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(anchor);
});

test('item menu: Delete -> confirm -> Cancel returns focus to the menu button', async () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onDeleteItem={vi.fn()} confirmSubtreeDelete />
  );
  const anchor = dots();
  fireEvent.click(anchor);
  fireEvent.click(screen.getByText('Delete'));
  await settle();
  fireEvent.click(screen.getByText('Cancel'));
  await settle();
  expect(document.activeElement).toBe(anchor);
});

test('item menu: Escape closes only the menu and refocuses the menu button', async () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onDeleteItem={vi.fn()} onDuplicateItem={vi.fn()} />
  );
  const anchor = dots();
  fireEvent.click(anchor);
  expect(anchor.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(anchor.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(anchor);
});

test('item menu: clicking the menu button again toggles the menu closed', async () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onDeleteItem={vi.fn()} />
  );
  const anchor = dots();
  fireEvent.click(anchor);
  expect(screen.getByRole('menu')).toBeTruthy();
  // Real order of events: mousedown on the anchor, then click.
  fireEvent.mouseDown(anchor);
  fireEvent.click(anchor);
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
});

test('item menu positive control: Duplicate calls back and closes the menu', async () => {
  const onDuplicateItem = vi.fn();
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onDuplicateItem={onDuplicateItem} onDeleteItem={vi.fn()} />
  );
  fireEvent.click(dots());
  fireEvent.click(screen.getByText('Duplicate'));
  await settle();
  expect(onDuplicateItem).toHaveBeenCalledWith('i1');
  expect(screen.queryByRole('menu')).toBeNull();
});

test('item menu positive control: Rename enters inline rename', async () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onRenameItem={vi.fn()} onDeleteItem={vi.fn()} />
  );
  fireEvent.click(dots());
  fireEvent.click(screen.getByText('Rename'));
  await settle();
  expect(screen.getByLabelText('Item name')).toBeTruthy();
});

const sections = [
  { id: 's1', title: 'Roof', items: [{ id: 'i1' }] },
  { id: 's2', title: 'Electrical', items: [{ id: 'i3' }] },
];

// Mirrors inspection-edit: onDeleteSection opens a parent-owned confirm Modal.
function RailHarness() {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <>
      <SectionRail mode="author" sections={sections} activeSection="s1" onSelect={() => {}}
        onDeleteSection={(id) => setPending(id)} onDuplicateSection={vi.fn()} />
      <Modal open={pending !== null} onClose={() => setPending(null)} title="Confirm section delete">
        <p>sure?</p>
      </Modal>
    </>
  );
}

test('section menu: Delete -> confirm -> Escape returns focus to the menu button', async () => {
  render(<RailHarness />);
  const anchor = dots();
  fireEvent.click(anchor);
  fireEvent.click(screen.getByText('Delete'));
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByText('Confirm section delete')).toBeTruthy();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await settle();
  expect(screen.queryByText('Confirm section delete')).toBeNull();
  expect(document.activeElement).toBe(anchor);
});

test('section menu positive control: Duplicate calls back', async () => {
  const onDuplicateSection = vi.fn();
  render(
    <SectionRail mode="author" sections={sections} activeSection="s1" onSelect={() => {}}
      onDuplicateSection={onDuplicateSection} onDeleteSection={vi.fn()} />
  );
  fireEvent.click(dots());
  fireEvent.click(screen.getByText('Duplicate'));
  await settle();
  expect(onDuplicateSection).toHaveBeenCalledWith('s1');
  expect(screen.queryByRole('menu')).toBeNull();
});

test('item menu: the panel is portaled to document.body, outside the row', async () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onDeleteItem={vi.fn()} />
  );
  fireEvent.click(dots());
  const menu = screen.getByRole('menu');
  const row = document.querySelector('[data-sortable-id="i1"]') as HTMLElement;
  expect(row.contains(menu)).toBe(false);
  expect(menu.parentElement?.parentElement).toBe(document.body);
});

test('section menu: the panel is portaled to document.body, outside the row', async () => {
  render(
    <SectionRail mode="author" sections={sections} activeSection="s1" onSelect={() => {}}
      onDeleteSection={vi.fn()} />
  );
  fireEvent.click(dots());
  const menu = screen.getByRole('menu');
  const row = document.querySelector('[data-sortable-id="s1"]') as HTMLElement;
  expect(row.contains(menu)).toBe(false);
  expect(menu.parentElement?.parentElement).toBe(document.body);
});

test('item menu: Alt+ArrowDown and F2 inside the menu do not reach the row handlers', async () => {
  const onMoveItem = vi.fn();
  const onRenameItem = vi.fn();
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()}
      onMoveItem={onMoveItem} onRenameItem={onRenameItem} onDeleteItem={vi.fn()} />
  );
  // Positive control: the same keys on the row itself still work.
  const rowButton = screen.getByText('Roof Covering');
  fireEvent.keyDown(rowButton, { key: 'ArrowDown', altKey: true });
  expect(onMoveItem).toHaveBeenCalledWith('i1', 1);
  onMoveItem.mockClear();
  fireEvent.keyDown(rowButton, { key: 'F2' });
  expect(screen.getByLabelText('Item name')).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText('Item name'), { key: 'Escape' });
  await settle();

  fireEvent.click(dots());
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown', altKey: true });
  fireEvent.keyDown(menu, { key: 'F2' });
  expect(onMoveItem).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Item name')).toBeNull();
});

test('section menu: Alt+ArrowDown and F2 inside the menu do not reach the row handlers', async () => {
  const onMoveSection = vi.fn();
  const onRenameSection = vi.fn();
  render(
    <SectionRail mode="author" sections={sections} activeSection="s1" onSelect={() => {}}
      onMoveSection={onMoveSection} onRenameSection={onRenameSection} onDeleteSection={vi.fn()} />
  );
  const rowButton = screen.getByText('Roof');
  fireEvent.keyDown(rowButton, { key: 'ArrowDown', altKey: true });
  expect(onMoveSection).toHaveBeenCalledWith('s1', 1);
  onMoveSection.mockClear();

  fireEvent.click(dots());
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown', altKey: true });
  fireEvent.keyDown(menu, { key: 'F2' });
  expect(onMoveSection).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Section name')).toBeNull();
});
