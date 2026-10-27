// @vitest-environment happy-dom
/**
 * The desktop header must fit every width from lg (1024) to 1920 without one element painting over another, an action
 * wrapping onto two lines, Publish being pushed off screen or the bar scrolling sideways. jsdom has no layout, so these
 * assert the classes the layout depends on; the widths themselves are measured in a real browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FieldDataSourceProvider } from '../../context';
import { createEmptyEditorData, createFakeDataSource } from '../../testing/fake-data-source';
import { m } from '../../i18n';
import { fullResources } from '../../editor/FieldEditor.capabilities.fixtures';
import { EditorHeader } from './EditorHeader';
import { UnitControls } from './UnitControls';
import { HEADER_OVERFLOW, pivotBreakpoint } from './header-visibility';

afterEach(cleanup);

const state = {
  inspection: { id: 'insp-1', propertyAddress: '1 Main St', status: 'draft' },
  formattedDate: '',
  overallStats: () => ({ rated: 1, total: 4, defect: 0, monitor: 0, etaMinutes: 0 }),
  saveStatus: 'idle',
  searchQuery: '',
  setSearchQuery: vi.fn(),
  setSettingsOpen: vi.fn(),
};

function mountHeader() {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: fullResources() });
  return render(
    <FieldDataSourceProvider dataSource={fake} slots={{ pdf: { run: vi.fn(), busy: false, error: null, actionLabel: (l) => l }, renderThemeControl: () => <div data-testid="theme" /> }}>
      <EditorHeader
        state={state as never}
        tenantSlug="acme"
        setSignModalOpen={vi.fn()}
        handlePublishClick={vi.fn()}
        handleFinishFieldwork={vi.fn()}
        finishingFieldwork={false}
        collabEditing
        onOpenVersionHistory={vi.fn()}
        onChangeTemplate={vi.fn()}
        onSaveAsNewTemplate={vi.fn()}
        onUpdateSourceTemplate={vi.fn()}
        canUpdateSourceTemplate={false}
        perUnitControls={<div data-testid="units-cluster" />}
      />
    </FieldDataSourceProvider>,
  );
}

const cls = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe('the header bar', () => {
  it('clips the identity zone instead of letting it paint over its neighbours, and keeps the neighbours at their size', () => {
    mountHeader();
    expect(cls('header-identity')).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'overflow-hidden']));
    expect(cls('header-actions')).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
    expect(cls('header-search')).toContain('shrink-0');
    expect(screen.getByTestId('units-cluster').parentElement?.className).toContain('shrink-0');
  });

  it('never wraps or shrinks the status badge, and shows it only from 1400px where the identity zone has room', () => {
    mountHeader();
    expect(cls('header-status')).toEqual(expect.arrayContaining(['hidden', 'min-[1400px]:inline-flex', 'shrink-0', 'whitespace-nowrap']));
  });

  it('shows the progress text only where the title still has room beside it', () => {
    mountHeader();
    const progress = screen.getByTestId('header-progress').className;
    expect(progress).toContain('hidden');
    expect(progress).toContain('min-[2400px]:flex');
    expect(progress).not.toContain('2xl:flex');
  });

  it('labels Report settings, Template and Preview only from 1920px, and below that they are icon-only with a name', () => {
    mountHeader();
    for (const label of [m.editor_header_settings(), m.template_menu_template(), m.editor_header_preview()]) {
      const span = screen.getAllByText(label, { selector: 'span' }).find((s) => s.className.includes('hidden'));
      expect(span?.className, label).toContain('min-[1920px]:inline');
    }
    // happy-dom ignores the hidden class, so a role-name query would pass without a label: ask for the attribute itself.
    for (const label of [m.editor_header_settings(), m.template_menu_template(), m.editor_header_preview()]) {
      expect(document.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
    }
    expect(screen.getByRole('textbox').getAttribute('aria-label')).toBe(m.editor_header_search_placeholder());
  });

  it('the search field has one width at every size', () => {
    mountHeader();
    expect(screen.getByRole('textbox').className).toContain('w-36');
    expect(screen.getByRole('textbox').className).not.toContain('2xl:w-44');
  });
});

describe('what moves into More, and where', () => {
  it('version history (with the search) is inline from xl, Sign from 1400px, Finish from 2xl, the theme control from 2100px', () => {
    expect(pivotBreakpoint(HEADER_OVERFLOW.versionHistory)).toBe('xl');
    expect(pivotBreakpoint(HEADER_OVERFLOW.sign)).toBe('min-[1400px]');
    expect(pivotBreakpoint(HEADER_OVERFLOW.finishFieldwork)).toBe('2xl');
    expect(pivotBreakpoint(HEADER_OVERFLOW.theme)).toBe('min-[2100px]');
  });

  it('CONTROL - a malformed pair is still rejected', () => {
    expect(pivotBreakpoint({ inline: 'hidden 2xl:inline-flex', row: 'xl:hidden' })).toBeNull();
    expect(pivotBreakpoint({ inline: 'hidden min-[1800px]:flex', row: 'min-[1700px]:hidden' })).toBeNull();
  });
});

describe('the per-unit cluster', () => {
  it('shows the Units and Cost Items labels only from 1700px, and caps a long scope name tighter below xl', () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: fullResources() });
    render(
      <FieldDataSourceProvider dataSource={fake}>
        <UnitControls isPerUnit units={[{ id: 'u1', name: 'A very long unit name that keeps going' } as never]} activeUnitId="u1" onSelectScope={vi.fn()} onOpenUnits={vi.fn()} onOpenCostItems={vi.fn()} />
      </FieldDataSourceProvider>,
    );
    const label = screen.getByText(m.editor_route_units(), { selector: 'span' });
    expect(label.className).toContain('min-[1700px]:inline');
    expect(label.className).toContain('hidden');
    for (const name of [m.editor_route_units(), m.editor_route_cost_items()]) {
      expect(document.querySelector(`[aria-label="${name}"]`), name).not.toBeNull();
    }
  });
});
