// @vitest-environment happy-dom
/**
 * The list inside a tablet pane: it fills the pane the parent sizes, rows are touch height, and the selected row
 * is marked by a tint, a 3px bar and a heavier weight, never by colour alone. Without `pane` nothing changes.
 */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from './ItemList';

const items = [
  { id: 'i1', label: 'Roof Covering', type: 'rich' },
  { id: 'i2', label: 'Roof Age', type: 'rich' },
];

const mountList = (pane: boolean) =>
  render(<ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()} pane={pane} />);
const row = (label: string) => screen.getByText(label).closest('[data-sortable-item]') as HTMLElement;
const root = (c: HTMLElement) => c.firstElementChild as HTMLElement;

test('pane: fluid width, no fixed 280px column and no right border of its own', () => {
  const { container } = mountList(true);
  expect(root(container).className).toContain('w-full');
  expect(root(container).className).toContain('min-w-0');
  expect(root(container).className).not.toContain('w-[280px]');
  expect(root(container).className).not.toContain('border-r');
});

test('pane: every row is at least 56px high and a touch target', () => {
  mountList(true);
  for (const label of ['Roof Covering', 'Roof Age']) {
    expect(row(label).className).toContain('min-h-14');
    expect(screen.getByText(label).closest('button')!.className).toContain('touch-manipulation');
  }
});

test('pane: the selected row has a tint, a 3px bar and bold text; the other row has none of them', () => {
  mountList(true);
  const on = row('Roof Covering');
  expect(on.className).toContain('bg-ih-primary-tint');
  expect(on.className).toContain('border-l-[3px]');
  expect(on.className).toContain('border-ih-primary');
  expect(on.className).toContain('font-bold');
  expect(on.className).toContain('text-ih-primary-text');
  const off = row('Roof Age');
  expect(off.className).not.toContain('bg-ih-primary-tint');
  expect(off.className).not.toContain('border-l-[3px]');
  expect(off.className).not.toContain('font-bold');
});

test('without pane the list is exactly the fixed 280px column it always was', () => {
  const { container } = mountList(false);
  expect(root(container).className).toBe('w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto flex flex-col');
  expect(row('Roof Covering').className).toBe('group relative flex items-stretch rounded-md text-[13px] transition-all bg-ih-bg-card shadow-ih-card border-l-[3px] border-ih-primary font-medium');
  expect(row('Roof Covering').className).not.toContain('min-h-14');
});
