import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { SectionRail } from '~/components/editor-shared/SectionRail';

const sections = [
  { id: 's1', title: 'Roof', items: [{ id: 'i1' }, { id: 'i2' }] },
  { id: 's2', title: 'Electrical', items: [{ id: 'i3' }] },
];

test('fill mode renders progress donut and Inspection Details overview', () => {
  render(
    <SectionRail
      mode="fill"
      sections={sections}
      activeSection="s1"
      onSelect={() => {}}
      results={{}}
      sectionProgress={() => ({ total: 2, rated: 1, percent: 50, hasDefect: false })}
      onSelectOverview={() => {}}
    />
  );
  expect(screen.getByTestId('inspection-details-entry')).toBeTruthy();
  expect(screen.getByText('Roof')).toBeTruthy();
});

test('author mode hides the Inspection Details overview and shows item counts', () => {
  render(
    <SectionRail
      mode="author"
      sections={sections}
      activeSection="s1"
      onSelect={() => {}}
      onAddSection={() => {}}
      onMoveSection={() => {}}
    />
  );
  expect(screen.queryByTestId('inspection-details-entry')).toBeNull();
  expect(screen.getByTestId('add-section-btn')).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy(); // Roof item count
});

test('author mode: clicking a section calls onSelect with its id', () => {
  const onSelect = vi.fn();
  render(
    <SectionRail mode="author" sections={sections} activeSection="s1" onSelect={onSelect} onAddSection={() => {}} />
  );
  fireEvent.click(screen.getByText('Electrical'));
  expect(onSelect).toHaveBeenCalledWith('s2');
});

test('fill mode: active overview entry sets aria-current and active styling', () => {
  render(
    <SectionRail
      mode="fill"
      sections={sections}
      activeSection="s1"
      onSelect={() => {}}
      results={{}}
      sectionProgress={() => ({ total: 2, rated: 1, percent: 50, hasDefect: false })}
      overviewActive
      onSelectOverview={() => {}}
    />
  );
  const entry = screen.getByTestId('inspection-details-entry');
  expect(entry.getAttribute('aria-current')).toBe('true');
  expect(entry.className).toContain('text-ih-primary');
});

test('author section has a drag handle when onReorderSection is wired', () => {
  render(<SectionRail mode="author" sections={sections} activeSection="s1" onSelect={()=>{}} onReorderSection={()=>{}} onAddSection={()=>{}} />);
  expect(screen.getByLabelText('Drag Roof')).toBeTruthy();
});
