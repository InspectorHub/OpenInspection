// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ItemList } from './ItemList';

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

test('touch targets: the drag handle and the options button grow to 44px on a coarse pointer, and keep their size with a mouse', () => {
  render(
    <ItemList mode="author" items={items} sectionId="s1" activeItemId="i1" onSelect={() => {}}
      onMoveItem={() => {}} onReorderItem={() => {}} onAddItem={() => {}} />
  );
  const handle = screen.getByLabelText('Drag Roof Covering');
  expect(handle.className).toContain('pointer-coarse:min-w-11');
  expect(handle.className).toContain('pointer-coarse:min-h-11');
  // The fine-pointer size is untouched: the base width class is still the only unconditional size.
  expect(handle.className).toContain('w-5');
  const options = screen.getAllByRole('button', { name: /^Edit Roof Covering/i })[0] ?? screen.getAllByLabelText(/Roof Covering/i).find((el) => el.getAttribute('aria-haspopup'));
  expect(options?.className).toContain('pointer-coarse:min-w-11');
  expect(options?.className).toContain('pointer-coarse:min-h-11');
  expect(options?.className).toContain('w-6 h-6');
});

// On a phone the list fills the Items drawer; the desktop's 280px column with a rule left a blank panel beside it.
test('fullWidth: fills its container, no fixed column, no vertical rule, names can still truncate', () => {
  const { container } = render(
    <ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()} results={{}} fullWidth />
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-full', 'min-w-0', 'flex', 'flex-col']));
  expect(root.className).not.toContain('w-[280px]');
  expect(root.className).not.toContain('border-r');
  expect(screen.getByText('Roof Covering').className).toContain('truncate');
});

test('CONTROL - without fullWidth the desktop column is unchanged', () => {
  const { container } = render(<ItemList mode="fill" items={items} sectionId="s1" activeItemId="i1" onSelect={vi.fn()} results={{}} />);
  expect((container.firstElementChild as HTMLElement).className).toContain('w-[280px]');
});

// The row dot shows the rating's own colour, so a rating whose id is not Satisfactory/Monitor/Defect is not grey.
describe('the rating dot', () => {
  const dot = (rating: string, getRatingColor?: (id: string) => string) => {
    const { container } = render(
      <ItemList mode="fill" items={[items[0]!]} sectionId="s1" activeItemId={null} onSelect={vi.fn()} results={{ '_default:s1:i1': { rating } }} getRatingColor={getRatingColor} />,
    );
    return container.querySelector('span.rounded-full.w-2') as HTMLElement;
  };

  test('takes the colour for a rating id it does not know by name', () => {
    const d = dot('Repair', () => '#7c3aed');
    expect(d.style.background).toBe('#7c3aed');
    expect(d.className).not.toContain('bg-ih-border-strong');
  });

  test('a tenant colour wins over the literal id mapping', () => {
    expect(dot('Defect', () => '#123456').style.background).toBe('#123456');
  });

  test('the fallback token is not painted as a fill: the neutral token class stays', () => {
    const d = dot('Repair', () => 'var(--ih-fg-5, #d4d4d8)');
    expect(d.style.background).toBe('');
    expect(d.className).toContain('bg-ih-border-strong');
  });

  test('an unsafe colour string is treated as no colour: nothing reaches the style, the id class stays', () => {
    for (const bad of ['url(https://x)', 'red; background:url(x)', 'expression(1)']) {
      const d = dot('Repair', () => bad);
      expect(d.getAttribute('style') ?? '').toBe('');
      expect(d.className).toContain('bg-ih-border-strong');
    }
    expect(dot('Defect', () => 'url(x)').className).toContain('bg-ih-bad');
  });

  test('CONTROL - without a colour the literal ids keep their classes', () => {
    expect(dot('Satisfactory').className).toContain('bg-ih-ok');
    expect(dot('DEF').className).toContain('bg-ih-bad');
    expect(dot('Repair').className).toContain('bg-ih-border-strong');
  });
});

test('asks for the dot of a row once per render', () => {
  const ask = vi.fn(() => '#7c3aed');
  render(<ItemList mode="fill" items={[items[0]!]} sectionId="s1" activeItemId={null} onSelect={vi.fn()} results={{ '_default:s1:i1': { rating: 'Repair' } }} getRatingColor={ask} />);
  expect(ask).toHaveBeenCalledTimes(1);
});
