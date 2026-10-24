import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { PublishModal } from './PublishModal';
import { FieldDataSourceProvider } from '../../context';
import { createEmptyEditorData, createFakeDataSource } from '../../testing/fake-data-source';

const fake = createFakeDataSource({ data: createEmptyEditorData() });
type ModalProps = Parameters<typeof PublishModal>[0];
/** The modal reads the viewer's zone, clock and editor path off the data source. */
function modal(props: ModalProps) {
  return React.createElement(FieldDataSourceProvider, { dataSource: fake }, React.createElement(PublishModal, props));
}

/**
 * Verifies that PublishModal renders an Auto-sign checkbox,
 * and that the `autoSign` prop controls the checked state.
 */

const baseProps = {
  open: true,
  inspectionId: 'insp-1',
  progress: { rated: 5, total: 10, pct: 50 },
  status: 'draft',
  publishError: null,
  isSubmitting: false,
  onClose: vi.fn(),
  onPublish: vi.fn(),
  // Not a revision: the auto-sign checkbox these tests match on is the ONLY
  // checkbox in the dialog, and a revision adds a textarea above it.
  isAmendment: false,
};

describe('PublishModal — Auto-sign checkbox', () => {
  it('renders an Auto-sign checkbox when autoSign=false', () => {
    const html = renderToStaticMarkup(
      modal({
        ...baseProps,
        autoSign: false,
        onAutoSignToggle: vi.fn(),
      }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Auto-sign');
  });

  it('renders the checkbox as unchecked when autoSign=false', () => {
    const html = renderToStaticMarkup(
      modal({
        ...baseProps,
        autoSign: false,
        onAutoSignToggle: vi.fn(),
      }),
    );
    // React serializes checked={false} by omitting the attribute
    // so we verify "checked" is NOT present in the checkbox input
    const checkboxMatch = html.match(/<input[^>]*type="checkbox"[^>]*>/);
    expect(checkboxMatch).not.toBeNull();
    expect(checkboxMatch![0]).not.toContain('checked');
  });

  it('renders the checkbox as checked when autoSign=true', () => {
    const html = renderToStaticMarkup(
      modal({
        ...baseProps,
        autoSign: true,
        onAutoSignToggle: vi.fn(),
      }),
    );
    const checkboxMatch = html.match(/<input[^>]*type="checkbox"[^>]*>/);
    expect(checkboxMatch).not.toBeNull();
    expect(checkboxMatch![0]).toContain('checked');
  });
});
