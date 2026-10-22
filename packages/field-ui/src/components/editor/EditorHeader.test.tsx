// @vitest-environment happy-dom
/**
 * The header takes its host-only UI (theme switch, PDF export) from slots and its navigation from the data
 * source, so a host that supplies none gets a header without those entry points rather than a crash.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FieldHostSlots, FieldUrls } from '../../data-source';
import { FieldDataSourceProvider } from '../../context';
import { createEmptyEditorData, createFakeDataSource } from '../../testing/fake-data-source';
import { EditorHeader } from './EditorHeader';

afterEach(cleanup);

const state = {
  inspection: { id: 'insp-1', propertyAddress: '1 Main St', status: 'draft' },
  formattedDate: '',
  overallStats: () => ({ rated: 0, total: 0, defect: 0, monitor: 0, etaMinutes: 0 }),
  saveStatus: 'idle',
  searchQuery: '',
  setSearchQuery: vi.fn(),
  setSettingsOpen: vi.fn(),
};

function mount(slots?: FieldHostSlots, extra: { tenantSlug?: string | null; urls?: Partial<FieldUrls> } = {}) {
  const fake = createFakeDataSource({
    data: createEmptyEditorData(),
    urls: { reportPreview: (slug, id) => `/report-view/${slug}/${id}`, ...extra.urls },
  });
  const ui: ReactNode = (
    <FieldDataSourceProvider dataSource={fake} slots={slots}>
      <EditorHeader
        state={state as never}
        tenantSlug={extra.tenantSlug ?? null}
        setSignModalOpen={vi.fn()}
        handlePublishClick={vi.fn()}
        handleFinishFieldwork={vi.fn()}
        finishingFieldwork={false}
        onChangeTemplate={vi.fn()}
        onSaveAsNewTemplate={vi.fn()}
        onUpdateSourceTemplate={vi.fn()}
        canUpdateSourceTemplate={false}
      />
    </FieldDataSourceProvider>
  );
  render(ui);
  return fake;
}

const PDF_SLOT: FieldHostSlots = {
  pdf: { run: vi.fn(), busy: false, error: null, actionLabel: (label) => label },
};
const previewButton = () => screen.queryByRole('button', { name: /preview/i });

describe('EditorHeader host slots', () => {
  it('renders without a theme control when the host supplies none', () => {
    mount();
    expect(screen.queryByTestId('theme-slot')).toBeNull();
  });

  it('renders no Preview control at all when there is neither a tenant link nor a PDF export', () => {
    mount(undefined, { tenantSlug: null });
    expect(previewButton()).toBeNull();
  });

  it('CONTROL - Preview appears with a tenant slug alone, and with a PDF export alone', () => {
    mount(undefined, { tenantSlug: 'acme' });
    expect(previewButton()).not.toBeNull();
    cleanup();
    mount(PDF_SLOT, { tenantSlug: null });
    expect(previewButton()).not.toBeNull();
  });

  it('renders the host theme control and runs the host PDF export for this inspection', () => {
    const run = vi.fn();
    mount({
      renderThemeControl: () => <span data-testid="theme-slot" />,
      pdf: { run, busy: false, error: null, actionLabel: (label) => `host:${label}` },
    });
    expect(screen.getAllByTestId('theme-slot').length).toBeGreaterThan(0);
    act(() => { screen.getByRole('button', { name: /preview/i }).click(); });
    const pdf = screen.getByTestId('preview-pdf-btn');
    expect(pdf.textContent).toContain('host:');
    act(() => { pdf.click(); });
    expect(run).toHaveBeenCalledWith('insp-1');
  });

  it('offers no PDF row when the host has no export, but still the web report for a known tenant', () => {
    mount(undefined, { tenantSlug: 'acme' });
    act(() => { previewButton()!.click(); });
    expect(screen.queryByTestId('preview-pdf-btn')).toBeNull();
    expect(screen.getByTestId('preview-report-btn')).toBeTruthy();
  });

  it('opens the web report at the data source URL for the tenant and inspection', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount(undefined, { tenantSlug: 'acme' });
    act(() => { previewButton()!.click(); });
    act(() => { screen.getByTestId('preview-report-btn').click(); });
    expect(open).toHaveBeenCalledWith('/report-view/acme/insp-1', '_blank', 'noopener');
    open.mockRestore();
  });
});

describe('EditorHeader back control', () => {
  it('is a real link when the host has an inspections list, and a plain click leaves through exit()', () => {
    const fake = mount();
    const back = screen.getByRole('link', { name: /back/i });
    expect(back.getAttribute('href')).toBe('/inspections');
    const allowed = fireEvent.click(back);
    expect(allowed).toBe(false); // default prevented: the host navigates, so its guards run
    expect(fake.exitCount).toBe(1);
  });

  it('leaves modified clicks to the browser (new tab, new window) and does not call exit()', () => {
    const fake = mount();
    const back = screen.getByRole('link', { name: /back/i });
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(fireEvent.click(back, init)).toBe(true);
    }
    expect(fake.exitCount).toBe(0);
  });

  it('is a button that calls exit() when the host has no inspections list (native)', () => {
    const fake = mount(undefined, { urls: { inspectionsList: undefined } });
    expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
    act(() => { screen.getByRole('button', { name: /back/i }).click(); });
    expect(fake.exitCount).toBe(1);
  });
});
