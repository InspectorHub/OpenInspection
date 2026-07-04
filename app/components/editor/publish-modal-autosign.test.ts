import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { PublishModal } from '~/components/editor/PublishModal';

/**
 * Verifies that PublishModal renders an Auto-sign checkbox,
 * and that the `autoSign` prop controls the checked state.
 */

const baseProps = {
  progress: { rated: 5, total: 10, pct: 50 },
  status: 'draft',
  publishError: null,
  isSubmitting: false,
  onClose: vi.fn(),
  onPublish: vi.fn(),
};

describe('PublishModal — Auto-sign checkbox', () => {
  it('renders an Auto-sign checkbox when autoSign=false', () => {
    const html = renderToStaticMarkup(
      React.createElement(PublishModal, {
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
      React.createElement(PublishModal, {
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
      React.createElement(PublishModal, {
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
